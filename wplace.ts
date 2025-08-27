import fs from "fs";
import mergeImages from "merge-images";
import got from "got";
import { Canvas, Image } from "canvas";
import { HttpsProxyAgent } from "hpagent";
import os from "os";
import { isMainThread, Worker } from "worker_threads";
import { workerFileName } from "./worker";

export type Proxy = {
    url: string;
    username?: string;
    password?: string;
    type: "http" | "https" | "srcip";
};

type Job = {
    name: string;
    xStart: number;
    yStart: number;
    xEnd: number;
    yEnd: number;
};

export const instance = got.extend({
    prefixUrl: "https://backend.wplace.live/",
    throwHttpErrors: false,
    retry: { limit: 0 },
    timeout: { request: 30000 },
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Priority: "u=3",
        Referer: "https://wplace.live/",
        "Sec-Ch-Ua": '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    },
    https: {
        rejectUnauthorized: false,
    },
});

import config from "./config.json" assert { type: "json" };

const jobs: Job[] = config.jobs;
export const proxies: Proxy[] = (config.proxyPool as Proxy[]) || [];

let proxyUtilization: number[] = Array(proxies.length).fill(0);

export function getLeastUsedProxy(): Proxy | null {
    if (proxies.length === 0) return null;
    let minUsage = Math.min(...proxyUtilization);
    let index = proxyUtilization.indexOf(minUsage);
    proxyUtilization[index]++;
    return proxies[index];
}

export function spawnHttpAgent(proxy: Proxy) {
    let authorization = proxy.username && proxy.password ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}` : undefined;
    let headers = authorization ? { authorization } : undefined;
    let httpAgent = new HttpsProxyAgent({
        proxy: proxy.url,
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 256,
        maxFreeSockets: 256,
        proxyRequestOptions: {
            headers,
        },
    });
    return httpAgent;
}

async function startJob(job: Job) {
    let curTime = new Date();
    let DateFormatter = Intl.DateTimeFormat("en-ca", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
    });
    let TimeFormatter = Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
    });

    let xStart = job.xStart;
    let yStart = job.yStart;
    let xEnd = job.xEnd;
    let yEnd = job.yEnd;
    let name = job.name || `x${xStart}-${xEnd}_y${yStart}-${yEnd}`;

    let filePath = `images/${name}/${DateFormatter.format(curTime).replace(/-/g, "/")}/${TimeFormatter.format(curTime).replace(/^24/,"00").replace(/:/g, "-")}Z`;
    fs.mkdirSync(filePath, { recursive: true });

    let abort = false;
    let livingThreads = 0;

    let threadSpawnSpeed = 500; // ms between spawning threads
    let threadLimit = 3; // this sets the default thread limit per proxy
    let requestSpeed = 1000; // ms. Probably don't set this too low or you will get rate limited, experimentally i have found that threadlimit 3 with 1000ms is the lowest you can go

    let startTime = process.hrtime.bigint();

    let nomerge = false;

    if ((xEnd - xStart) * 1000 * ((yEnd - yStart) * 1000) * 4.5 > os.totalmem()) {
        console.log("Warning: This job requires more memory than your system has available. Merging will not be attempted.");
        nomerge = true;
    }

    if (proxies.length > 0) {
        threadLimit *= proxies.length;
    }

    threadLimit = Math.min(threadLimit, xEnd - xStart + 1); // No need to have more threads than rows
    //threadLimit = Math.min(threadLimit, 256); // try not to overwhelm the process with too many threads

    return new Promise(async function (resolve, reject) {
        console.log("poking the bear...");
        let result = await instance.get(`files/s0/tiles/0/0.png`);
        console.log(`poke status: ${result.statusCode}`);
        if (result.statusCode === 429) {
            await new Promise((resolve) => setTimeout(resolve, parseInt(result.headers["retry-after"] || "60") * 1050));
        } else if (result.statusCode !== 200) reject(`poke failed: ${result.statusCode}`);

        for (let x = xStart; x <= xEnd; x++) {
            if (abort) break;
            while (livingThreads >= threadLimit) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            } // Wait if too many threads

            livingThreads++;
            console.log(`Starting row ${x} (${livingThreads} threads alive)`);

            let worker = new Worker(`import('tsx/esm/api').then(({ register }) => { register(); import('${workerFileName}') })`, {
                eval: true,
                workerData: {
                    x,
                    yStart,
                    yEnd,
                    filePath,
                    requestSpeed,
                    proxy: getLeastUsedProxy(),
                },
            });

            worker.on("message", (msg) => {
                if (msg.done) {
                    livingThreads--;
                    console.log(`Finished row ${x} (${livingThreads} threads alive)`);
                }
                if (msg.proxy) {
                    let index = proxies.indexOf(msg.proxy);
                    if (index !== -1) proxyUtilization[index]--;
                }
            });

            await new Promise((resolve) => setTimeout(resolve, threadSpawnSpeed));
        }
        while (livingThreads > 0) {
            await new Promise((resolve) => setTimeout(resolve, threadSpawnSpeed));
        }
        console.log("All done! Finished in " + Number(process.hrtime.bigint() - startTime) / 1000000000 + "s");

        if (nomerge) {
            console.log("Skipping merge due to memory constraints.");
            resolve(true);
            return;
        }

        mergeImages(
            [
                ...Array.from({ length: xEnd - xStart + 1 }, (_, i) =>
                    Array.from({ length: yEnd - yStart + 1 }, (_, j) => ({
                        src: `./${filePath}/wplace_s0_${xStart + i}_${yStart + j}.png`,
                        x: i * 1000,
                        y: j * 1000,
                    }))
                ).flat(),
            ],
            {
                Canvas: Canvas,
                Image: Image,
                width: (xEnd - xStart + 1) * 1000,
                height: (yEnd - yStart + 1) * 1000,
            }
        ).then((b64: string) => {
            let data = b64.replace(/^data:image\/\w+;base64,/, "");
            let buf = Buffer.from(data, "base64");
            fs.writeFileSync(`./${filePath}_merged.png`, buf);
            console.log("Merged image saved!");
            fs.rmSync(`./${filePath}`, { recursive: true });
            resolve(true);
        });
    });
}

if (isMainThread) {
    for (let job of jobs) {
        console.log(`Starting job: ${job.name || `x${job.xStart}-${job.xEnd}_y${job.yStart}-${job.yEnd}`}`);
        await startJob(job);
    }
}
