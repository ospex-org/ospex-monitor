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
dotenv.config();
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.PROVIDER);
const cfpAddress = process.env.CFPADDRESS;
const contestAddress = process.env.CONTESTADDRESS;
const CFPv1_json_1 = __importDefault(require("../abis/CFPv1.json"));
const ContestOracleResolved_json_1 = __importDefault(require("../abis/ContestOracleResolved.json"));
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
    const sportspageIds = contestsPending.map((contest) => contest.sportspageId);
    for (const id of sportspageIds) {
        try {
            const result = yield getSportspageResults(id);
            const contestIdToScore = contestsPending.find((contest) => contest.sportspageId === result.results[0].gameId.toString());
            if (result.results[0].status === "final" && contestIdToScore) {
                const rundownResults = yield getRundownResults(contestIdToScore.rundownId);
                if (rundownResults.score.event_status === "STATUS_FINAL") {
                    const autoResponse = yield executeAutotask(process.env.SCORE_CONTEST_AUTOTASK_WEBHOOK, contestIdToScore.id);
                    if (autoResponse.status === "success") {
                        console.log("Score Contest response status:", autoResponse.status);
                        console.log("Contest scored:", contestIdToScore.id);
                        contestsPending.splice(contestsPending.findIndex((a) => a.id === contestIdToScore.id), 1);
                    }
                    else {
                        throw new Error(autoResponse.status);
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
                const response = yield executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.id);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.id);
                    speculationsPendingScore.push({ id: speculation.id, contestId: speculation.contestId });
                    const index = speculationsPendingLock.findIndex(a => a.id === speculation.id);
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
        const contest = contestsPending.find(a => a.id === speculation.contestId);
        if (!contest) {
            try {
                const response = yield executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.id);
                if (response.status === 'success') {
                    console.log('Score Speculation response status:', response.status);
                    console.log('Speculation scored:', speculation.id);
                    const index = speculationsPendingScore.findIndex(a => a.id === speculation.id);
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
function monitor() {
    return __awaiter(this, void 0, void 0, function* () {
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
                if (!contestsCreated.some(contest => (contest.id === Number(value.args.id)))) {
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
            if (!contestsScored.some(contest => contest.id === Number(value.args.id))) {
                contestsScored.push({
                    id: Number(value.args.id)
                });
            }
        }
        contestsCreated.forEach(element => {
            if (!(contestsScored.some(contest => contest.id === element.id))) {
                contestsPending.push(element);
            }
        });
        for (const key in speculationsCreatedEvents) {
            const value = speculationsCreatedEvents[key];
            if (value.args.speculationCreator === process.env.CONTESTCREATOR || value.args.speculationCreator === process.env.RELAYER) {
                if (!speculationsCreated.some(speculation => (speculation.id === Number(value.args.id)))) {
                    const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId));
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
            if (!speculationsLocked.some(speculation => speculation.id === Number(value.args.id))) {
                const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId));
                if (validContest) {
                    speculationsLocked.push({
                        id: Number(value.args.id),
                        contestId: Number(value.args.contestId)
                    });
                }
            }
        }
        speculationsCreated.forEach(element => {
            if (!(speculationsLocked.some(speculation => speculation.id === element.id))) {
                speculationsPendingLock.push(element);
            }
        });
        for (const key in speculationsScoredEvents) {
            const value = speculationsScoredEvents[key];
            if (!speculationsScored.some(speculation => speculation.id === Number(value.args.id))) {
                const validContest = contestsCreated.some(contest => contest.id === Number(value.args.contestId));
                if (validContest) {
                    speculationsScored.push({
                        id: Number(value.args.id),
                        contestId: Number(value.args.contestId)
                    });
                }
            }
        }
        speculationsLocked.forEach(element => {
            if (!(speculationsScored.some(speculation => speculation.id === element.id))) {
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
        contestContract.on('ContestCreated', (id, rundownId, sportspageId) => {
            contestsPending.push({
                id: Number(id),
                rundownId,
                sportspageId
            });
            console.log('New contests pending array:', contestsPending);
        });
        cfpContract.on('SpeculationCreated', (id, contestId, lockTime) => {
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
    });
}
exports.monitor = monitor;
//# sourceMappingURL=monitor.js.map