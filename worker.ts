import { spawnHttpAgent, instance, type Proxy } from "./wplace";
import fs from "fs";
import type { Options, Response } from "got";
import { isMainThread, parentPort, workerData } from "worker_threads";

export const workerFileName = import.meta.url;

if (!isMainThread) {
    const x: number = workerData.x;
    const yStart: number = workerData.yStart;
    const yEnd: number = workerData.yEnd;
    const filePath: string = workerData.filePath;
    const requestSpeed: number = workerData.requestSpeed;
    const proxy: Proxy | undefined = workerData.proxy;

    let localOpts = {} as Options;
    if (proxy) {
        switch (proxy.type) {
            case "http":
            case "https":
                let httpAgent = spawnHttpAgent(proxy);
                localOpts.agent = {
                    http: httpAgent,
                    https: httpAgent,
                };
                break;
            case "srcip":
                localOpts.localAddress = proxy.url;
                break;
        }
    }

    for (let y = yStart; y <= yEnd; y++) {
        let result: Response<string>;
        try {
            result = await (instance.get(`files/s0/tiles/${x}/${y}.png`, localOpts) as Promise<Response<string>>);
        } catch (e) {
            console.log(`Tile ${x}, ${y} failed to fetch (network error?), retrying in 10s...`);
            console.log(e.message);
            await new Promise((resolve) => setTimeout(resolve, 10000));
            y--;
            continue;
        }

        if (result.statusCode === 404) {
            fs.copyFileSync(`./empty.png`, `./${filePath}/wplace_s0_${x}_${y}.png`);
            if (!proxy) console.log(`Tile ${x}, ${y} is empty.`); // this gets really spammy with many proxies
            await new Promise((resolve) => setTimeout(resolve, requestSpeed));
            continue;
        }
        if (result.statusCode !== 200) {
            let retryAfter: string | number = result.headers["retry-after"] || "";
            if (retryAfter.length > 0) retryAfter = parseInt(retryAfter);
            else retryAfter = 10;

            console.log(`Tile ${x}, ${y} failed to fetch (${result.statusCode}), retrying in ${retryAfter}s...`);
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1050));
            y--;
            continue;
        }

        let buffer = result.rawBody;
        fs.writeFileSync(`./${filePath}/wplace_s0_${x}_${y}.png`, buffer);
        if (!proxy) console.log(`Saved tile ${x}, ${y}`); // this gets really spammy with many proxies
        await new Promise((resolve) => setTimeout(resolve, requestSpeed));
    }

    parentPort?.postMessage({ done: true, proxy });
}
