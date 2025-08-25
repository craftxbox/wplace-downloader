import fs from "fs";
import mergeImages from "merge-images";
const { Canvas, Image } = require("canvas");

let xStart = 705;
let yStart = 705;
let xEnd = 725;
let yEnd = 725;

let curTime = new Date();
let DateFormatter = Intl.DateTimeFormat("en-ca", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});
let TimeFormatter = Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
});

let filePath = `images/x${xStart}-${xEnd}_y${yStart}-${yEnd}/${DateFormatter.format(curTime).replace(/-/g, "/")}/${TimeFormatter.format(curTime).replace(/:/g, "-")}Z`;
fs.mkdirSync(filePath, { recursive: true });

let abort = false;
let livingThreads = 0;

setImmediate(async function () {
    console.log("poking the bear...");
    let result = await fetch(`https://backend.wplace.live/files/s0/tiles/0/0.png`);
    console.log(`poke status: ${result.status}`);
    if (result.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, parseInt(result.headers.get("Retry-After") || "60") * 1050));
    }

    for (let x = xStart; x <= xEnd; x++) {
        if (abort) break;
        while (livingThreads >= 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } // Wait if there are already 3 threads
        setImmediate(async function () {
            livingThreads++;
            console.log(`Starting column ${x} (${livingThreads} threads alive)`);
            for (let y = yStart; y <= yEnd; y++) {
                if (abort) return;
                let result = await fetch(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);

                if (result.status === 404) {
                    fs.copyFileSync(`./empty.png`, `./${filePath}/wplace_s0_${x}_${y}.png`);
                    console.log(`Tile ${x}, ${y} is empty.`);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }

                if (result.status !== 200) {
                    console.log(`Tile ${x}, ${y} failed to fetch (${result.status}), aborting!`);
                    abort = true;
                    return;
                }

                let buffer = await result.arrayBuffer();
                fs.writeFileSync(`./${filePath}/wplace_s0_${x}_${y}.png`, Buffer.from(buffer));
                console.log(`Saved tile ${x}, ${y}`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            livingThreads--;
            console.log(`Finished column ${x} (${livingThreads} threads alive)`);
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    while (livingThreads > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("All done!");

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
        fs.rmdirSync(`./${filePath}`, { recursive: true });
    });
});
