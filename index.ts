import express, { Express, Request, Response } from 'express';
import {config} from "./config";
import { monitor } from './src/monitor';

const app: Express = express();

app.get('/', (req: Request, res: Response) => {
    res.send('ospex server');
});

app.listen(config.server.port, () => {
    monitor();
    return console.log(`[server]: Server is running on ${config.server.port}`);
});