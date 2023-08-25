"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitor = void 0;
const ethers_1 = require("ethers");
const schedule = __importStar(require("node-schedule"));
const dotenv = __importStar(require("dotenv"));
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const EthCrypto = require('eth-crypto');
const sourceFilePath = path.join(__dirname, 'contestScoring.js');
dotenv.config();
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.PROVIDER);
const wallet = new ethers_1.ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);
const cfpAddress = process.env.CFPADDRESS;
const contestAddress = process.env.CONTESTADDRESS;
const CFPv1_json_1 = __importDefault(require("../abis/CFPv1.json"));
const ContestOracleResolved_json_1 = __importDefault(require("../abis/ContestOracleResolved.json"));
const contestContract = new ethers_1.ethers.Contract(contestAddress, ContestOracleResolved_json_1.default, wallet);
const headers = {
    'Content-Type': 'application/json'
};
const contestsCreated = [], contestsPending = [], contestsScored = [], speculationsCreated = [], speculationsPendingLock = [], speculationsLocked = [], speculationsPendingScore = [], speculationsScored = [];
function getRundownResults(eventId) {
    return axios({
        url: `${process.env.RUNDOWN_API_URL}${eventId}`,
        method: 'get',
        params: { include: 'scores' },
        timeout: 60000,
        headers: {
            'x-rapidapi-host': 'therundown-therundown-v1.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_API_KEY
        }
    })
        .then((response) => response.data)
        .catch((error) => console.log(error));
}
function getSportspageResults(eventId) {
    return axios({
        url: process.env.SPORTSPAGE_GAMEBYID_API_URL,
        method: 'get',
        params: { gameId: eventId },
        timeout: 60000,
        headers: {
            'x-rapidapi-host': 'sportspage-feeds.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_API_KEY
        }
    })
        .then((response) => response.data)
        .catch((error) => console.log(error));
}
function getJsonoddsResults(eventId) {
    return axios({
        url: `${process.env.JSONODDS_GAMEBYID_API_URL}${eventId}`,
        method: 'get',
        timeout: 60000,
        headers: {
            'x-api-key': process.env.JSONODDS_API_KEY
        }
    })
        .then((response) => response.data[0])
        .catch((error) => console.log(error));
}
function executeAutotask(url, id) {
    return axios({
        url,
        method: 'post',
        timeout: 60000,
        headers,
        data: id
    })
        .then((response) => response.data)
        .catch((error) => console.log(error));
}
const scoreContests = (contestsPending) => __awaiter(void 0, void 0, void 0, function* () {
    const source = fs.readFileSync(sourceFilePath, 'utf8');
    const secrets = EthCrypto.cipher.stringify(yield EthCrypto.encryptWithPublicKey(process.env.DON_PUBLIC_KEY, "https://testbucket20230723v.s3.us-west-1.amazonaws.com/offchain-secrets2.json"));
    const subscriptionId = 1981;
    const gasLimit = 300000;
    const sportspageIds = contestsPending.map((contest) => contest.sportspageId);
    for (const id of sportspageIds) {
        try {
            const result = yield getSportspageResults(id);
            const contestIdToScore = contestsPending.find((contest) => contest.sportspageId === result.results[0].gameId.toString());
            if (result.results[0].status === "final" && contestIdToScore) {
                const rundownResult = yield getRundownResults(contestIdToScore.rundownId);
                const jsonoddsResult = yield getJsonoddsResults(contestIdToScore.jsonoddsId);
                if (rundownResult.score.event_status === "STATUS_FINAL" && jsonoddsResult.Final) {
                    try {
                        const tx = yield contestContract.scoreContest(contestIdToScore.contestId, source, '0x' + secrets, subscriptionId, gasLimit, {
                            gasLimit: 15000000
                        });
                        const receipt = yield tx.wait();
                        console.log("Score Contest mined in block:", receipt.blockNumber);
                        console.log("Contest scored:", contestIdToScore.contestId);
                        contestsPending.splice(contestsPending.findIndex((a) => a.contestId === contestIdToScore.contestId), 1);
                    }
                    catch (error) {
                        throw new Error(`Error while scoring contest: ${error}`);
                    }
                }
            }
        }
        catch (error) {
            throw new Error(`Error while scoring contest: ${error}`);
        }
    }
});
const lockSpeculations = () => __awaiter(void 0, void 0, void 0, function* () {
    for (const speculation of speculationsPendingLock) {
        const curDate = Date.now() / 1000;
        if (speculation.lockTime && curDate > speculation.lockTime) {
            try {
                const response = yield executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.speculationId);
                    speculationsPendingScore.push({ speculationId: speculation.speculationId, contestId: speculation.contestId });
                    const index = speculationsPendingLock.findIndex(a => a.speculationId === speculation.speculationId);
                    speculationsPendingLock.splice(index, 1);
                }
                else {
                    console.log(response.status);
                }
            }
            catch (error) {
                console.log(error);
            }
        }
    }
});
const scoreSpeculations = () => __awaiter(void 0, void 0, void 0, function* () {
    for (const speculation of speculationsPendingScore) {
        const contest = contestsPending.find(a => a.contestId === speculation.contestId);
        if (!contest) {
            try {
                const response = yield executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Score Speculation response status:', response.status);
                    console.log('Speculation scored:', speculation.speculationId);
                    const index = speculationsPendingScore.findIndex(a => a.speculationId === speculation.speculationId);
                    speculationsPendingScore.splice(index, 1);
                }
                else {
                    console.log(response.status);
                }
            }
            catch (error) {
                console.log(error);
            }
        }
    }
});
const monitor = () => __awaiter(void 0, void 0, void 0, function* () {
    const cfpContract = new ethers_1.ethers.Contract(cfpAddress, CFPv1_json_1.default, provider);
    const contestContract = new ethers_1.ethers.Contract(contestAddress, ContestOracleResolved_json_1.default, provider);
    const contestsCreatedEventFilter = contestContract.filters.ContestCreated();
    const contestsScoredEventFilter = contestContract.filters.ContestScored();
    const speculationsCreatedFilter = cfpContract.filters.SpeculationCreated();
    const speculationsLockedFilter = cfpContract.filters.SpeculationLocked();
    const speculationsScoredFilter = cfpContract.filters.SpeculationScored();
    const contestsCreatedEvents = yield contestContract.queryFilter(contestsCreatedEventFilter);
    const contestsScoredEvents = yield contestContract.queryFilter(contestsScoredEventFilter);
    const speculationsCreatedEvents = yield cfpContract.queryFilter(speculationsCreatedFilter);
    const speculationsLockedEvents = yield cfpContract.queryFilter(speculationsLockedFilter);
    const speculationsScoredEvents = yield cfpContract.queryFilter(speculationsScoredFilter);
    // load arrays
    for (const key in contestsCreatedEvents) {
        const value = contestsCreatedEvents[key];
        if (value.args.contestCreator === process.env.CONTESTCREATOR || value.args.contestCreator === process.env.RELAYER) {
            if (!contestsCreated.some(contest => (contest.contestId === Number(value.args.contestId)))) {
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
        if (!contestsScored.some(contest => contest.contestId === Number(value.args.contestId))) {
            contestsScored.push({
                contestId: Number(value.args.contestId)
            });
        }
    }
    contestsCreated.forEach(element => {
        if (!(contestsScored.some(contest => contest.contestId === element.contestId))) {
            contestsPending.push(element);
        }
    });
    for (const key in speculationsCreatedEvents) {
        const value = speculationsCreatedEvents[key];
        if (value.args.speculationCreator === process.env.CONTESTCREATOR || value.args.speculationCreator === process.env.RELAYER) {
            if (!speculationsCreated.some(speculation => (speculation.speculationId === Number(value.args.speculationId)))) {
                const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId));
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
        if (!speculationsLocked.some(speculation => speculation.speculationId === Number(value.args.speculationId))) {
            const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId));
            if (validContest) {
                speculationsLocked.push({
                    speculationId: Number(value.args.speculationId),
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }
    speculationsCreated.forEach(element => {
        if (!(speculationsLocked.some(speculation => speculation.speculationId === element.speculationId))) {
            speculationsPendingLock.push(element);
        }
    });
    for (const key in speculationsScoredEvents) {
        const value = speculationsScoredEvents[key];
        if (!speculationsScored.some(speculation => speculation.speculationId === Number(value.args.speculationId))) {
            const validContest = contestsCreated.some(contest => contest.contestId === Number(value.args.contestId));
            if (validContest) {
                speculationsScored.push({
                    speculationId: Number(value.args.speculationId),
                    contestId: Number(value.args.contestId)
                });
            }
        }
    }
    speculationsLocked.forEach(element => {
        if (!(speculationsScored.some(speculation => speculation.speculationId === element.speculationId))) {
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
    contestContract.on('ContestCreated', (contestId, rundownId, sportspageId, jsonoddsId) => {
        contestsPending.push({
            contestId: Number(contestId),
            rundownId,
            sportspageId,
            jsonoddsId
        });
        console.log('New contests pending array:', contestsPending);
    });
    cfpContract.on('SpeculationCreated', (speculationId, contestId, lockTime) => {
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
});
exports.monitor = monitor;
//# sourceMappingURL=monitor.js.map