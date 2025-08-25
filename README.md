# WPlace Downloader
This is a very hastily thrown together script to capture segments of the wplace map and turn them into one very large snapshot.

## Getting Started
This guide expects you already have NodeJS 20 or later installed.  
Clone the repo and run `npm install`  
  
Create a `config.json` file in the root of the project, following the format in the example below:  
```json
{
    "jobs": [
        {
            "name": "whatever you want",
            "xStart": 0,
            "yStart": 0,
            "xEnd": 10,
            "yEnd": 10
        }
    ]
}
```
You can find the tile/chunk coordinates you need using [Overlay Pro](https://greasyfork.org/en/scripts/545041-wplace-overlay-pro) or by manually screwing around in the console  
  
Large captures will take a considerable amount of time,  
if you get hit with 429 errors and the downloader aborts, try closing all the wplace tabs you have open.  
  
When you are ready to start, run `npx tsx .` and it should start the process.  
When it is finished, the finalized file will be somewhere inside the `images` folder. You are looking for the file ending in `_merged`
