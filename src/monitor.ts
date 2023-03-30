import { ethers } from 'ethers';
import * as schedule from 'node-schedule';
import * as dotenv from 'dotenv';
const axios = require('axios').default;

dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER);
const cfpAddress = process.env.CFPADDRESS!;
const contestAddress = process.env.CONTESTADDRESS!;
import cfpAbi from '../abis/CFPv1.json'
import contestAbi from '../abis/ContestOracleResolved.json'

const headers = {
	'Content-Type': 'application/json'
}

interface RundownResponse {
    data: RundownResult
}

interface RundownResult {
    event_id: string,
    event_date: Date,
    score: {
        event_status: string,
        score_away: number,
        score_home: number
    },
    teams: [
        {
            name: string
        },
        {
            name: string
        }
    ],
    teams_normalized: [
        {
            abbreviation: string
        },
        {
            abbreviation: string
        }
    ]
    schedule: {
        event_name: string
    }
}

interface SportspageResults {
    results: [
        {
            schedule: {
                date: Date,
                tbaTime: boolean
            },
            summary: string,
            details: {
                league: string
            },
            status: string,
            teams: {
                away: {
                    team: string
                    abbreviation: string
                },
                home: {
                    team: string
                    abbreviation: string
                }
            },
            gameId: number,
            scoreboard: {
                score: {
                    away: number,
                    home: number
                }
            }
        }
    ]
}

interface SportspageResponse {
    data: SportspageResults
}

interface AutotaskResponse {
    data: AutotaskResult
}

interface AutotaskResult {
    autotaskRunId?: string,
    autotaskId?: string,
    trigger?: string,
    status: string,
    createdAt?: string,
    encodedLogs?: string,
    result: string,
    requestId?: string
}

interface contests {
    id: number,
    rundownId?: string,
    sportspageId?: string,
    contestCreator?: string
}

interface speculations {
    id: number, 
    contestId: number, 
    lockTime?: number, 
    speculationCreator?: string
}

const contestsCreated: contests[] = [], 
      contestsPending: contests[] = [],
      contestsScored: contests[] = [], 
      speculationsCreated: speculations[] = [],
      speculationsPendingLock: speculations[] = [],
      speculationsLocked: speculations[] = [],
      speculationsPendingScore: speculations[] = [],
      speculationsScored: speculations[] = [];

function getRundownResults(eventId: string) {
    return axios({
        url: `${process.env.RUNDOWN_API_URL}${eventId}`,
        method: 'get',
        params: {include: 'scores'},
        timeout: 60000,
        headers: {
            'x-rapidapi-host': 'therundown-therundown-v1.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_API_KEY
        }
    })
    .then((response: RundownResponse) => response.data)
    .catch((error: Error) => console.log(error));
}

function getSportspageResults(eventId: string) {
    return axios({
        url: process.env.SPORTSPAGE_GAMEBYID_API_URL,
        method: 'get',
        params: {gameId: eventId},
        timeout: 60000,
        headers: {
            'x-rapidapi-host': 'sportspage-feeds.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_API_KEY
        }
    })
    .then((response: SportspageResponse) => response.data)
    .catch((error: Error) => console.log(error));
}

function executeAutotask(url: string, id: number) {
    return axios({
        url,
        method: 'post',
        timeout: 60000,
        headers,
        data: id
    })
    .then((response: AutotaskResponse) => response.data)
    .catch((error: Error) => console.log(error));
}

const scoreContests = async (contestsPending: contests[]): Promise<void> => {
    const sportspageIds = contestsPending.map((contest) => contest.sportspageId);
    for (const id of sportspageIds) {
      try {
        const result: SportspageResults = await getSportspageResults(id!);
        const contestIdToScore = contestsPending.find(
          (contest) => contest.sportspageId === result.results[0].gameId.toString()
        );
        if (result.results[0].status === "final" && contestIdToScore) {
          const rundownResults: RundownResult = await getRundownResults(contestIdToScore.rundownId!);
          if (rundownResults.score.event_status === "STATUS_FINAL") {
            const autoResponse: AutotaskResult = await executeAutotask(
              process.env.SCORE_CONTEST_AUTOTASK_WEBHOOK!,
              contestIdToScore.id
            );
            if (autoResponse.status === "success") {
              console.log("Score Contest response status:", autoResponse.status);
              console.log("Contest scored:", contestIdToScore.id);
              contestsPending.splice(
                contestsPending.findIndex((a) => a.id === contestIdToScore.id),
                1
              );
            } else {
              throw new Error(autoResponse.status);
            }
          }
        }
      } catch (error) {
        throw new Error(`Error while scoring contest: ${error}`);
      }
    }
};

const lockSpeculations = async () => {
    for (const speculation of speculationsPendingLock) {
        const curDate = Date.now() / 1000;
        if (speculation.lockTime && curDate > speculation.lockTime) {
            try {
                const response = await executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.id);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.id);
                    speculationsPendingScore.push({id: speculation.id, contestId: speculation.contestId});
                    const index = speculationsPendingLock.findIndex(a => a.id === speculation.id);
                    speculationsPendingLock.splice(index, 1);
                } else {
                    console.log(response.status);
                }
            } catch (error) {
                console.log(error);
            }
        }
    }
}

const scoreSpeculations = async () => {
    for (const speculation of speculationsPendingScore) {
        const contest = contestsPending.find(a => a.id === speculation.contestId);
        if (!contest) {
            try {
                const response = await executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.id);
                if (response.status === 'success') {
                    console.log('Score Speculation response status:', response.status);
                    console.log('Speculation scored:', speculation.id);
                    const index = speculationsPendingScore.findIndex(a => a.id === speculation.id);
                    speculationsPendingScore.splice(index, 1);
                } else {
                    console.log(response.status);
                }
            } catch (error) {
                console.log(error);
            }
        }
    }
}

const monitor = async () => {
    const cfpContract = new ethers.Contract(cfpAddress, cfpAbi, provider);
    const contestContract = new ethers.Contract(contestAddress, contestAbi, provider);
    const contestsCreatedEventFilter = contestContract.filters.ContestCreated();
    const contestsScoredEventFilter = contestContract.filters.ContestScored();
    const speculationsCreatedFilter = cfpContract.filters.SpeculationCreated();
    const speculationsLockedFilter = cfpContract.filters.SpeculationLocked();
    const speculationsScoredFilter = cfpContract.filters.SpeculationScored();
    const contestsCreatedEvents: any = await contestContract.queryFilter(contestsCreatedEventFilter);
    const contestsScoredEvents: any = await contestContract.queryFilter(contestsScoredEventFilter);
    const speculationsCreatedEvents: any = await cfpContract.queryFilter(speculationsCreatedFilter);
    const speculationsLockedEvents: any = await cfpContract.queryFilter(speculationsLockedFilter);
    const speculationsScoredEvents: any = await cfpContract.queryFilter(speculationsScoredFilter);

    // load arrays
    for (const key in contestsCreatedEvents) {
        const value = contestsCreatedEvents[key];
        if(value.args.contestCreator === process.env.CONTESTCREATOR || value.args.contestCreator === process.env.RELAYER) {
            if(!contestsCreated.some(contest => (contest.id === Number(value.args.id)))) {
                contestsCreated.push({
                    id: Number(value.args.id), 
                    rundownId: value.args.rundownId,
                    sportspageId: value.args.sportspageId,
                    contestCreator: value.args.contestCreator
                });
            }
        }
    }

    for (const key in contestsScoredEvents) {
        const value = contestsScoredEvents[key];
        if(!contestsScored.some(contest => contest.id === Number(value.args.id))) {
            contestsScored.push({
                id: Number(value.args.id)
            });
        }
    }

    contestsCreated.forEach(element => {
        if(!(contestsScored.some(contest => contest.id === element.id))) {
            contestsPending.push(element);
        }
    });

    for (const key in speculationsCreatedEvents) {
        const value = speculationsCreatedEvents[key];
        if(value.args.speculationCreator === process.env.CONTESTCREATOR || value.args.speculationCreator === process.env.RELAYER) {
            if(!speculationsCreated.some(speculation => (speculation.id === Number(value.args.id)))) {
                const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId))
                if (validContest) {
                    speculationsCreated.push({
                        id: Number(value.args.id), 
                        contestId: Number(value.args.contestId), 
                        lockTime: Number(value.args.lockTime),
                        speculationCreator: value.args.speculationCreator
                    });
                }
            }
        }
    }

    for (const key in speculationsLockedEvents) {
        const value = speculationsLockedEvents[key];
        if(!speculationsLocked.some(speculation => speculation.id === Number(value.args.id))) {
            const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId))
            if (validContest) {
                speculationsLocked.push({
                    id: Number(value.args.id), 
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }

    speculationsCreated.forEach(element => {
        if(!(speculationsLocked.some(speculation => speculation.id === element.id))) {
            speculationsPendingLock.push(element);
        }
    });

    for (const key in speculationsScoredEvents) {
        const value = speculationsScoredEvents[key];
        if(!speculationsScored.some(speculation => speculation.id === Number(value.args.id))) {
            const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId))
            if (validContest) {
                speculationsScored.push({
                    id: Number(value.args.id), 
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }

    speculationsLocked.forEach(element => {
        if(!(speculationsScored.some(speculation => speculation.id === element.id))) {
            speculationsPendingScore.push(element);
        }
    });

    console.log('contests created:', contestsCreated);
    console.log('contests scored:', contestsScored);
    console.log('contests pending:', contestsPending);
    console.log('speculations created:', speculationsCreated);
    console.log('speculations locked:', speculationsLocked);
    console.log('speculations pending lock:', speculationsPendingLock);
    console.log('speculations scored:', speculationsScored);
    console.log('speculations pending score:', speculationsPendingScore);

    contestContract.on('ContestCreated', (id: bigint, rundownId: string, sportspageId: string) => {
        contestsPending.push({
            id: Number(id), 
            rundownId,
            sportspageId
        });
        console.log('New contests pending array:', contestsPending);
    });

    cfpContract.on('SpeculationCreated', (id: bigint, contestId: string, lockTime: string) => {
        speculationsPendingLock.push({
            id: Number(id), 
            contestId: Number(contestId), 
            lockTime: Number(lockTime)
        });
        console.log('New speculations pending lock array:', speculationsPendingLock);
    });

    const scoreContestJob = schedule.scheduleJob(`*/${process.env.REFRESH_RATE} * * * *`, () => {
        console.log('Running function to score contests');
        scoreContests(contestsPending);
    });

    const lockContestSpeculationJob = schedule.scheduleJob(`*/${process.env.REFRESH_RATE} * * * *`, () => {
        console.log('Running function to lock speculations');
        lockSpeculations();
    });

    const scoreContestSpeculationJob = schedule.scheduleJob(`*/${process.env.REFRESH_RATE} * * * *`, () => {
        console.log('Running function to score speculations');
        scoreSpeculations();
    });

}

export { monitor }