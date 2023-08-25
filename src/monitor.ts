import { ethers } from 'ethers';
import * as schedule from 'node-schedule';
import * as dotenv from 'dotenv';
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const EthCrypto = require('eth-crypto');
const sourceFilePath = path.join(__dirname, 'contestScoring.js');

dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER);
const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY!, provider);
const cfpAddress = process.env.CFPADDRESS!;
const contestAddress = process.env.CONTESTADDRESS!;
import cfpAbi from '../abis/CFPv1.json'
import contestAbi from '../abis/ContestOracleResolved.json'

const contestContract = new ethers.Contract(contestAddress, contestAbi, wallet);

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

interface SportspageResponse {
    data: SportspageResults
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

interface JsonoddsResponse {
    data: [JsonoddsResult]
}

interface JsonoddsResult {
    ID: string,
    HomeScore: number,
    AwayScore: number,
    Final: boolean
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
    contestId: number,
    rundownId?: string,
    sportspageId?: string,
    jsonoddsId?: string,
    contestCreator?: string
}

interface speculations {
    speculationId: number, 
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

function getJsonoddsResults(eventId: string) {
    return axios({
        url: `${process.env.JSONODDS_GAMEBYID_API_URL}${eventId}`,
        method: 'get',
        timeout: 60000,
        headers: {
            'x-api-key': process.env.JSONODDS_API_KEY
        }
    })
    .then((response: JsonoddsResponse) => response.data[0])
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
    const source = fs.readFileSync(sourceFilePath, 'utf8');
    const secrets = EthCrypto.cipher.stringify(
        await EthCrypto.encryptWithPublicKey(
            process.env.DON_PUBLIC_KEY,
            "https://testbucket20230723v.s3.us-west-1.amazonaws.com/offchain-secrets2.json"
        ),
    );
    const subscriptionId = 1981;
    const gasLimit = 300000;
    
    const sportspageIds = contestsPending.map((contest) => contest.sportspageId);
    for (const id of sportspageIds) {
      try {
        const result: SportspageResults = await getSportspageResults(id!);
        const contestIdToScore = contestsPending.find(
          (contest) => contest.sportspageId === result.results[0].gameId.toString()
        );
        if (result.results[0].status === "final" && contestIdToScore) {
          const rundownResult: RundownResult = await getRundownResults(contestIdToScore.rundownId!);
          const jsonoddsResult: JsonoddsResult = await getJsonoddsResults(contestIdToScore.jsonoddsId!);
          if (rundownResult.score.event_status === "STATUS_FINAL" && jsonoddsResult.Final) {
            try {
                const tx = await contestContract.scoreContest(contestIdToScore.contestId, source, '0x' + secrets, subscriptionId, gasLimit, {
                    gasLimit: 15000000
                });
                const receipt = await tx.wait();
                console.log("Score Contest mined in block:", receipt.blockNumber);
                console.log("Contest scored:", contestIdToScore.contestId);
                contestsPending.splice(
                    contestsPending.findIndex((a) => a.contestId === contestIdToScore.contestId),
                    1
                );
            } catch (error) {
                throw new Error(`Error while scoring contest: ${error}`);
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
                const response = await executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.speculationId);
                    speculationsPendingScore.push({speculationId: speculation.speculationId, contestId: speculation.contestId});
                    const index = speculationsPendingLock.findIndex(a => a.speculationId === speculation.speculationId);
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
        const contest = contestsPending.find(a => a.contestId === speculation.contestId);
        if (!contest) {
            try {
                const response = await executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Score Speculation response status:', response.status);
                    console.log('Speculation scored:', speculation.speculationId);
                    const index = speculationsPendingScore.findIndex(a => a.speculationId === speculation.speculationId);
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
            if(!contestsCreated.some(contest => (contest.contestId === Number(value.args.contestId)))) {
                contestsCreated.push({
                    contestId: Number(value.args.contestId), 
                    rundownId: value.args.rundownId,
                    sportspageId: value.args.sportspageId,
                    jsonoddsId: value.args.jsonoddsId,
                    contestCreator: value.args.contestCreator
                });
            }
        }
    }

    for (const key in contestsScoredEvents) {
        const value = contestsScoredEvents[key];
        if(!contestsScored.some(contest => contest.contestId === Number(value.args.contestId))) {
            contestsScored.push({
                contestId: Number(value.args.contestId)
            });
        }
    }

    contestsCreated.forEach(element => {
        if(!(contestsScored.some(contest => contest.contestId === element.contestId))) {
            contestsPending.push(element);
        }
    });

    for (const key in speculationsCreatedEvents) {
        const value = speculationsCreatedEvents[key];
        if(value.args.speculationCreator === process.env.CONTESTCREATOR || value.args.speculationCreator === process.env.RELAYER) {
            if(!speculationsCreated.some(speculation => (speculation.speculationId === Number(value.args.speculationId)))) {
                const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId))
                if (validContest) {
                    speculationsCreated.push({
                        speculationId: Number(value.args.speculationId), 
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
        if(!speculationsLocked.some(speculation => speculation.speculationId === Number(value.args.speculationId))) {
            const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId))
            if (validContest) {
                speculationsLocked.push({
                    speculationId: Number(value.args.speculationId), 
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }

    speculationsCreated.forEach(element => {
        if(!(speculationsLocked.some(speculation => speculation.speculationId === element.speculationId))) {
            speculationsPendingLock.push(element);
        }
    });

    for (const key in speculationsScoredEvents) {
        const value = speculationsScoredEvents[key];
        if(!speculationsScored.some(speculation => speculation.speculationId === Number(value.args.speculationId))) {
            const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId))
            if (validContest) {
                speculationsScored.push({
                    speculationId: Number(value.args.speculationId), 
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }

    speculationsLocked.forEach(element => {
        if(!(speculationsScored.some(speculation => speculation.speculationId === element.speculationId))) {
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

    contestContract.on('ContestCreated', (contestId: bigint, rundownId: string, sportspageId: string, jsonoddsId: string) => {
        contestsPending.push({
            contestId: Number(contestId), 
            rundownId,
            sportspageId,
            jsonoddsId
        });
        console.log('New contests pending array:', contestsPending);
    });

    cfpContract.on('SpeculationCreated', (speculationId: bigint, contestId: string, lockTime: string) => {
        speculationsPendingLock.push({
            speculationId: Number(speculationId), 
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