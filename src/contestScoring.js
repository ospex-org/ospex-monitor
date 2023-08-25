if (secrets.rapidapiKey == "" ) {
  throw Error("RAPID_API_KEY environment variable not set.")
};
    
if (secrets.jsonapiKey == "" ) {
  throw Error("JSON_API_KEY environment variable not set.")
};
      
const rundownId = args[0];
const sportspageId = args[1];
const jsonoddsId = args[2];
  
const rundownRequest = Functions.makeHttpRequest({
  url: 'https://therundown-therundown-v1.p.rapidapi.com/events/' + rundownId + '?include=scores',
  headers: {
    'x-rapidapi-host': 'therundown-therundown-v1.p.rapidapi.com',
    'x-rapidapi-key': secrets.rapidapiKey
  },
});
    
const sportspageRequest = Functions.makeHttpRequest({
  url: 'https://sportspage-feeds.p.rapidapi.com/gameById?gameId=' + +sportspageId,
  headers: {
    'x-rapidapi-host': 'sportspage-feeds.p.rapidapi.com',
    'x-rapidapi-key': secrets.rapidapiKey
  },
});
    
const jsonoddsRequest = Functions.makeHttpRequest({
  url: 'https://jsonodds.com/api/results/' + jsonoddsId,
  headers: {
    'x-api-key': secrets.jsonapiKey
  }
});
    
const rundownResponse = await rundownRequest;
const sportspageResponse = await sportspageRequest;
const jsonoddsResponse = await jsonoddsRequest;

let rundownResult;
let sportspageResult;
let jsonoddsResult;
  
if (!rundownResponse.error) {
  if (rundownResponse.data['score']['event_status'] === 'STATUS_FINAL') {
    const awayScore = rundownResponse.data['score']['score_away'];
    const homeScore = rundownResponse.data['score']['score_home'];
    rundownResult = awayScore * 1000 + homeScore;
  };
} else {
  throw Error ("Rundown API error:", rundownResponse.error);
};
    
if (!sportspageResponse.error) {
  if (sportspageResponse.data['results']['0']['status'] === 'final') {
    const awayScore = sportspageResponse.data['results']['0']['scoreboard']['score']['away'];
    const homeScore = sportspageResponse.data['results']['0']['scoreboard']['score']['home'];
    sportspageResult = awayScore * 1000 + homeScore;
  }
} else {
  throw Error ("Sportspage API error:", sportspageResponse.error);
};
    
if (!jsonoddsResponse.error) {
  if (jsonoddsResponse.data[0]['Final']) {
    const awayScore = +jsonoddsResponse.data[0]['AwayScore'];
    const homeScore = +jsonoddsResponse.data[0]['HomeScore'];
    jsonoddsResult = awayScore * 1000 + homeScore;
  }
} else {
  throw Error ("Jsonodds API error:", jsonoddsResponse.error);
};
  
console.log("rundownResult:", rundownResult);
console.log("sportspageResult:", sportspageResult);
console.log("jsonoddsResult:", jsonoddsResult);

if (rundownResult === sportspageResult && rundownResult === jsonoddsResult) {
  return Functions.encodeUint256(rundownResult);
} else {
  throw Error ("Invalid contest IDs")
};
