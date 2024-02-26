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

const cfpContract = new ethers.Contract(cfpAddress, cfpAbi, provider);
const contestContract = new ethers.Contract(contestAddress, contestAbi, provider);

const headers = {
	'Content-Type': 'application/json'
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

interface Speculation {
    speculationId: number, 
    contestId: number, 
    lockTime?: number, 
    speculationCreator?: string
}

const speculationsCreated: Speculation[] = [],
      speculationsLocked: Speculation[] = [],
      speculationsScored = new Set<number>(),
      scoredContests = new Set<number>();

const executeAutotask = (url: string, id: number) => {
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

const loadScoredContests = async () => {
    const scoredEvents = await contestContract.queryFilter(contestContract.filters.ContestScored());
    for (const event of scoredEvents) {
        const contestScoredEvent = event as ethers.EventLog;
        let contestId;
        if (typeof contestScoredEvent.args.contestId === 'object' && contestScoredEvent.args.contestId.toNumber) {
            contestId = contestScoredEvent.args.contestId.toNumber();
        } else {
            contestId = parseInt(contestScoredEvent.args.contestId);
        }
        scoredContests.add(contestId);
    }
}

const isContestScored = (contestId: number): boolean => {
    return scoredContests.has(contestId);
}

const lockSpeculations = async () => {
    for (const speculation of speculationsCreated) {
        const curDate = Date.now() / 1000;
        // no longer restricting to only the contest creator
        if (speculation.lockTime && curDate > speculation.lockTime /* && speculation.speculationCreator === process.env.CONTESTCREATOR */) {
            try {
                const response = await executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.speculationId);
                    speculationsLocked.push({speculationId: speculation.speculationId, contestId: speculation.contestId});
                    const index = speculationsCreated.findIndex(a => a.speculationId === speculation.speculationId);
                    if (index !== -1) speculationsCreated.splice(index, 1);
                } else {
                    console.log('error in lockSpeculations function, response was unsuccessful:', response.status);
                }
            } catch (error) {
                console.log('error in lockSpeculations function:', error);
            }
        }
    }
}

const scoreSpeculations = async (speculations: Speculation[]) => {
    for (const speculation of speculations) {
        try {
            const response = await executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK!, speculation.speculationId);
            if (response.status === 'success') {
                console.log('Speculation scored:', speculation.speculationId);
                const indexCreated = speculationsCreated.findIndex(s => s.speculationId === speculation.speculationId);
                if (indexCreated !== -1) speculationsCreated.splice(indexCreated, 1);
                const indexLocked = speculationsLocked.findIndex(s => s.speculationId === speculation.speculationId);
                if (indexLocked !== -1) speculationsLocked.splice(indexLocked, 1);
                speculationsScored.add(speculation.speculationId);
            } else {
                console.log('error in scoreSpeculations function, response was unsuccessful:', response.status);
            }
        } catch (error) {
            console.log('error in scoreSpeculations function:', error);
        }
    }
}

const scoreSpeculationsByContestId = async (scoredContestId: number) => {
    const speculationsToScore = speculationsLocked.filter(s => s.contestId === scoredContestId);
    await scoreSpeculations(speculationsToScore);
}

const handleContestScored = async (contestId: string) => {
    const contestIdNum = Number(contestId);

    const createdSpeculationsToScore = speculationsCreated.filter(s => s.contestId === contestIdNum);
    await scoreSpeculations(createdSpeculationsToScore);

    const lockedSpeculationsToScore = speculationsLocked.filter(s => s.contestId === contestIdNum);
    await scoreSpeculations(lockedSpeculationsToScore);

    console.log('updated speculations created:', speculationsCreated);
    console.log('updated speculations locked:', speculationsLocked);
    console.log('updated speculations scored:', speculationsScored);
}

const handleSpeculationCreated = (
    speculationId: bigint, 
    contestId: string, 
    lockTime: string, 
    speculationScorer: string,
    theNumber: number,
    speculationCreator: string) => {
        const exists = speculationsCreated.some(speculation => speculation.speculationId === Number(speculationId));
        // no longer restricting to only the contest creator
        if (!exists /* && speculationCreator === process.env.CONTESTCREATOR */) {
            speculationsCreated.push({
                speculationId: Number(speculationId), 
                contestId: Number(contestId), 
                lockTime: Number(lockTime),
                speculationCreator
            });
            console.log('New speculations created array:', speculationsCreated);
        }
    }

const monitor = async () => {
    await loadScoredContests();
    const speculationsCreatedEvents: any = await cfpContract.queryFilter(cfpContract.filters.SpeculationCreated());
    const speculationsLockedEvents: any = await cfpContract.queryFilter(cfpContract.filters.SpeculationLocked());
    const speculationsScoredEvents: any = await cfpContract.queryFilter(cfpContract.filters.SpeculationScored());

    for (const event of speculationsScoredEvents) {
        speculationsScored.add(Number(event.args.speculationId));
    }

    for (const event of speculationsLockedEvents) {
        const speculationId = Number(event.args.speculationId);
        const contestId = Number(event.args.contestId);
        if (!speculationsScored.has(speculationId)) {
            speculationsLocked.push({
                speculationId, 
                contestId
            });
        }
    }

    for (const event of speculationsCreatedEvents) {
        const speculationId = Number(event.args.speculationId);
        const contestId = Number(event.args.contestId);
        const lockTime = Number(event.args.lockTime);
        const speculationCreator = event.args.speculationCreator;
        // no longer restricting to only the contest creator
        if (!speculationsScored.has(speculationId) /* && speculationCreator === process.env.CONTESTCREATOR */ && !speculationsLocked.some(s => s.speculationId === speculationId)) {
            speculationsCreated.push({
                speculationId, 
                contestId, 
                lockTime,
                speculationCreator
            });
        }
    }    

    console.log('speculations created:', speculationsCreated);
    console.log('speculations locked:', speculationsLocked);
    console.log('speculations scored:', speculationsScored);

    const speculationsToScoreOnStartup = [
        ...speculationsCreated.filter(s => isContestScored(s.contestId)),
        ...speculationsLocked.filter(s => isContestScored(s.contestId))
    ];

    for (const speculation of speculationsToScoreOnStartup) {
        await scoreSpeculationsByContestId(speculation.contestId);
    }

    contestContract.on('ContestScored', (contestId: string) => handleContestScored(contestId));
    cfpContract.on('SpeculationCreated', (
        speculationId: bigint, 
        contestId: string, 
        lockTime: string, 
        speculationScorer: string, 
        theNumber: number, 
        speculationCreator: string) => handleSpeculationCreated(
        speculationId, 
        contestId, 
        lockTime, 
        speculationScorer, 
        theNumber, 
        speculationCreator
    ));

    const lockContestSpeculationJob = schedule.scheduleJob(`*/${process.env.REFRESH_RATE} * * * *`, () => {
        console.log('Running function to lock speculations');
        lockSpeculations();
    });

}

export { monitor }