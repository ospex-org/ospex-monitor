"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const monitor_1 = require("./src/monitor");
const app = (0, express_1.default)();
app.get('/', (req, res) => {
    res.send('ospex server');
});
app.listen(config_1.config.server.port, () => {
    (0, monitor_1.monitor)();
    return console.log(`[server]: Server is running on ${config_1.config.server.port}`);
});
//# sourceMappingURL=index.js.map