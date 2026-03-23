
async function getGridData(lat, lng) {
  const userAgent = "PeakCam/1.0 (contact@peakcam.io)";
  const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
  
  const pointsResp = await fetch(pointsUrl, { headers: { "User-Agent": userAgent } });
  if (!pointsResp.ok) return null;
  const pointsData = await pointsResp.json();
  
  const gridResp = await fetch(pointsData.properties.forecastGridData, { headers: { "User-Agent": userAgent } });
  if (!gridResp.ok) return null;
  return await gridResp.json();
}

async function main() {
  // Vail Mountain, CO
  const vail = { lat: 39.6433, lng: -106.3781, elev: 8120 }; 
  const data = await getGridData(vail.lat, vail.lng);
  
  if (!data) {
    console.error("Failed to fetch data");
    return;
  }
  
  const props = data.properties;
  
  // Let's look at the next 12 hours
  console.log("Analyzing NWS Grid Data for Ski Conditions (Next 12 Hours)\n");
  
  const extractLatest = (layer) => {
    if (!layer || !layer.values || layer.values.length === 0) return "N/A";
    // Just grab the first value for demonstration
    const val = layer.values[0].value;
    if (val === null) return "N/A";
    
    // Convert units if needed based on layer.uom
    if (layer.uom === "wmoUnit:degC") return `${(val * 9/5 + 32).toFixed(1)} °F`;
    if (layer.uom === "wmoUnit:km_h-1") return `${(val * 0.621371).toFixed(1)} mph`;
    if (layer.uom === "wmoUnit:m") return `${(val * 3.28084).toFixed(0)} ft`;
    if (layer.uom === "wmoUnit:percent") return `${val}%`;
    if (layer.uom === "wmoUnit:mm") return `${(val / 25.4).toFixed(2)} in`;
    
    return `${val} (${layer.uom})`;
  };

  console.log("🌤️  VISIBILITY & SKY");
  console.log(`Sky Cover: ${extractLatest(props.skyCover)}`);
  console.log(`Visibility: ${extractLatest(props.visibility)}`);
  
  console.log("\n🥶 COMFORT & WIND");
  console.log(`Temperature: ${extractLatest(props.temperature)}`);
  console.log(`Wind Chill: ${extractLatest(props.windChill)}`);
  console.log(`Wind Speed: ${extractLatest(props.windSpeed)}`);
  console.log(`Wind Gust: ${extractLatest(props.windGust)}`);
  
  console.log("\n🌨️  PRECIPITATION & SNOW QUALITY");
  console.log(`Prob of Precip: ${extractLatest(props.probabilityOfPrecipitation)}`);
  console.log(`Snow Level: ${extractLatest(props.snowLevel)} (Resort Base: ${vail.elev} ft)`);
  console.log(`Ice Accumulation: ${extractLatest(props.iceAccumulation)}`);
}

main();
