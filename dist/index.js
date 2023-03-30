"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
// import {config} from "./config";
const monitor_1 = require("./src/monitor");
const app = (0, express_1.default)();
app.get('/', (req, res) => {
    res.send('ospex server');
});
// app.listen(config.server.port, () => {
//     monitor();
//     return console.log(`[server]: Server is running on ${config.server.port}`);
// });
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    (0, monitor_1.monitor)();
    console.log(`App listening on port ${PORT}!`);
});
//# sourceMappingURL=index.js.map