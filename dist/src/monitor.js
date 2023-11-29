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
const cfpContract = new ethers_1.ethers.Contract(cfpAddress, CFPv1_json_1.default, provider);
const contestContract = new ethers_1.ethers.Contract(contestAddress, ContestOracleResolved_json_1.default, provider);
const headers = {
    'Content-Type': 'application/json'
};
const speculationsCreated = [], speculationsLocked = [], speculationsScored = new Set(), scoredContests = new Set();
const executeAutotask = (url, id) => {
    return axios({
        url,
        method: 'post',
        timeout: 60000,
        headers,
        data: id
    })
        .then((response) => response.data)
        .catch((error) => console.log(error));
};
const loadScoredContests = () => __awaiter(void 0, void 0, void 0, function* () {
    const scoredEvents = yield contestContract.queryFilter(contestContract.filters.ContestScored());
    for (const event of scoredEvents) {
        const contestScoredEvent = event;
        let contestId;
        if (typeof contestScoredEvent.args.contestId === 'object' && contestScoredEvent.args.contestId.toNumber) {
            contestId = contestScoredEvent.args.contestId.toNumber();
        }
        else {
            contestId = parseInt(contestScoredEvent.args.contestId);
        }
        scoredContests.add(contestId);
    }
});
const isContestScored = (contestId) => {
    return scoredContests.has(contestId);
};
const lockSpeculations = () => __awaiter(void 0, void 0, void 0, function* () {
    for (const speculation of speculationsCreated) {
        const curDate = Date.now() / 1000;
        if (speculation.lockTime && curDate > speculation.lockTime && speculation.speculationCreator === process.env.CONTESTCREATOR) {
            try {
                const response = yield executeAutotask(process.env.LOCK_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.speculationId);
                if (response.status === 'success') {
                    console.log('Lock Speculation response status:', response.status);
                    console.log('Speculation locked:', speculation.speculationId);
                    speculationsLocked.push({ speculationId: speculation.speculationId, contestId: speculation.contestId });
                    const index = speculationsCreated.findIndex(a => a.speculationId === speculation.speculationId);
                    if (index !== -1)
                        speculationsCreated.splice(index, 1);
                }
                else {
                    console.log('error in lockSpeculations function, response was unsuccessful:', response.status);
                }
            }
            catch (error) {
                console.log('error in lockSpeculations function:', error);
            }
        }
    }
});
const scoreSpeculations = (speculations) => __awaiter(void 0, void 0, void 0, function* () {
    for (const speculation of speculations) {
        try {
            const response = yield executeAutotask(process.env.SCORE_CONTEST_SPECULATION_AUTOTASK_WEBHOOK, speculation.speculationId);
            if (response.status === 'success') {
                console.log('Speculation scored:', speculation.speculationId);
                const indexCreated = speculationsCreated.findIndex(s => s.speculationId === speculation.speculationId);
                if (indexCreated !== -1)
                    speculationsCreated.splice(indexCreated, 1);
                const indexLocked = speculationsLocked.findIndex(s => s.speculationId === speculation.speculationId);
                if (indexLocked !== -1)
                    speculationsLocked.splice(indexLocked, 1);
                speculationsScored.add(speculation.speculationId);
            }
            else {
                console.log('error in scoreSpeculations function, response was unsuccessful:', response.status);
            }
        }
        catch (error) {
            console.log('error in scoreSpeculations function:', error);
        }
    }
});
const scoreSpeculationsByContestId = (scoredContestId) => __awaiter(void 0, void 0, void 0, function* () {
    const speculationsToScore = speculationsLocked.filter(s => s.contestId === scoredContestId);
    yield scoreSpeculations(speculationsToScore);
});
const handleContestScored = (contestId) => __awaiter(void 0, void 0, void 0, function* () {
    const contestIdNum = Number(contestId);
    const createdSpeculationsToScore = speculationsCreated.filter(s => s.contestId === contestIdNum);
    yield scoreSpeculations(createdSpeculationsToScore);
    const lockedSpeculationsToScore = speculationsLocked.filter(s => s.contestId === contestIdNum);
    yield scoreSpeculations(lockedSpeculationsToScore);
    console.log('updated speculations created:', speculationsCreated);
    console.log('updated speculations locked:', speculationsLocked);
    console.log('updated speculations scored:', speculationsScored);
});
const handleSpeculationCreated = (speculationId, contestId, lockTime, speculationScorer, theNumber, speculationCreator) => {
    const exists = speculationsCreated.some(speculation => speculation.speculationId === Number(speculationId));
    if (!exists && speculationCreator === process.env.CONTESTCREATOR) {
        speculationsCreated.push({
            speculationId: Number(speculationId),
            contestId: Number(contestId),
            lockTime: Number(lockTime),
            speculationCreator
        });
        console.log('New speculations created array:', speculationsCreated);
    }
};
const monitor = () => __awaiter(void 0, void 0, void 0, function* () {
    yield loadScoredContests();
    const speculationsCreatedEvents = yield cfpContract.queryFilter(cfpContract.filters.SpeculationCreated());
    const speculationsLockedEvents = yield cfpContract.queryFilter(cfpContract.filters.SpeculationLocked());
    const speculationsScoredEvents = yield cfpContract.queryFilter(cfpContract.filters.SpeculationScored());
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
        if (!speculationsScored.has(speculationId) && speculationCreator === process.env.CONTESTCREATOR && !speculationsLocked.some(s => s.speculationId === speculationId)) {
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
        yield scoreSpeculationsByContestId(speculation.contestId);
    }
    contestContract.on('ContestScored', (contestId) => handleContestScored(contestId));
    cfpContract.on('SpeculationCreated', (speculationId, contestId, lockTime, speculationScorer, theNumber, speculationCreator) => handleSpeculationCreated(speculationId, contestId, lockTime, speculationScorer, theNumber, speculationCreator));
    const lockContestSpeculationJob = schedule.scheduleJob(`*/${process.env.REFRESH_RATE} * * * *`, () => {
        console.log('Running function to lock speculations');
        lockSpeculations();
    });
});
exports.monitor = monitor;
//# sourceMappingURL=monitor.js.map