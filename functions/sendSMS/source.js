/** 
 * Send weather notifications via SMS. 
 * 
 * When the fuck will we move this to VCS and stop using Stitch?
 */

console.log('Test');
 
 const PATH_LUT = {};
 
/**
 * Return the current UTC time in HH:MM format.
 * 
 * @todo Address potential time drift issues.
 * @return {String} The time.
 */
function getCurrentTime() { // Current iteration of the function does not guard against any potential time desync (i.e. trigger drifts n < 15 minutes) and will silently fail.
  const date = new Date();
  const timeString = date.toTimeString().substr(0, 5);
  console.log(`Current time is ${timeString}`);
  return timeString;
}

/**
 * Translate a ClimaCell {@link weatherCondition} to its corresponding Danbooru tag.
 * 
 * @todo Figure out how to scale this to multiple Danbooru aggregators (tags will probably differ between instances).
 * @param {String} weatherCondition - A ClimaCell API `weather_code` value.
 * @return {String} A Danbooru tag.
 */
function getTagFromWeatherCondition(weatherCondition) {
  switch (weatherCondition) {
    case 'freezing_rain_heavy':
    case 'rain_heavy':
    case 'tstorm':
      result = 'storm';
      break;
    case 'freezing_rain':
    case 'freezing_rang_light':
    case 'freezing_drizzle':
    case 'rain_light':
    case 'drizzle':
    case 'rain':
      result = 'rain';
      break;
    case 'ice_pellets_heavy':
    case 'ice_pellets':
    case 'ice_pellets_light':
    case 'snow_heavy':
    case 'snow':
    case 'snow_light':
    case 'flurries':
      result = 'snow snowing'.split(' ')[Math.floor(Math.random() * 2)];
      break;
    case 'cloudy':
    case 'mostly_cloudy':
    case 'partly_cloudy':
      result = 'overcast';
      break;
    case 'mostly_clear':
    case 'clear':
      result = 'cloudy_sky'
    default:
      result = 'clear_sky';
      break;
  }
  return result;
}

/**
 * Retrieve an image URL from a Danbooru post that contains all {@link tags}.
 * 
 * @todo Support more Danbooru instances (e.g. Yande.re, Gelbooru, Sankaku).
 * @todo Use in-house randomization because some Danbooru instances do not support random posts.
 * @param {...string} tags - A list of Danbooru tags.
 * @return {Promise<String>} An image URL.
 */
function getDanbooruImageURL(...tags) {
  return context.http.get({
    'scheme': 'https',
    'host': 'safebooru.donmai.us',
    'path': '/posts.json',
    'query': {
      'random': ['true'],
      'limit': ['1'],
      'tags': ['solo', ...tags], // WARNING: Do not pass more than one tag (API limits 2 tags/search)
    }
  })
  .then(response => {
    const data = EJSON.parse(response.body.text());
    const { file_size, file_url, large_file_url } = data[0];
    return file_size >= 5242880 ? large_file_url : file_url; // Twilio does not support images over 5 Mb in size.
  })
  .catch(err => console.error(`Failed to retrieve image URL: ${err}`));
}

/**
 * Retrieve weather data via the ClimaCell API.
 * 
 * @todo Expand this to support different endpoints
 * @todo Maybe support user-specified fields?
 * @param {number} latitude - A latitude.
 * @param {number} longitude - A longitude.
 * @param {Promise<Object>} Weather data.
 */
function getWeatherData(latitude, longitude) {
  if (90 - Math.abs(latitude) < 0) throw new RangeError('Latitude must be between -90 and 90.')
  else if (180 - Math.abs(longitude) < 0) throw new RangeError('Longitude must be beween -180 and 180.')
  const API_KEY = context.values.get('CLIMACELL_API_KEY');
  return context.http.get({
      scheme: 'https',
      host: 'api.climacell.co',
      path: '/v3/weather/forecast/daily',
      query: {
        'lat': [`${latitude}`],
        'lon': [`${longitude}`],
        'apikey': [API_KEY],
        'unit_system': ['us'],
        'end_time': ['now'],
        'fields': ['wind_speed', 'wind_direction', 'temp', 'weather_code']
      }
    })
    .then(response => {
      const data = EJSON.parse(response.body.text());
      return data[0]; // We only care about the first dataset.
    })
    .catch(err => console.error(`Failed to retrieve weather data: ${err}`));
}

/**
 * Return a time word that relatively corresponds to the current time.
 * 
 * @todo Ensure that the end-user will NOT be able to request notifications at any time other than the morning.
 * @return {String} A time word.
 */
function getTimeWord() {
  const currentHour = new Date().getHours();
  if (currentHour < 12) return 'morning';
  else if (currentHour < 18) return 'afternoon';
  else return 'evening';
}


/**
 * Construct and return the weather notification body text.
 * 
 * @todo Validate the incoming data (maybe?).
 * @param {Object} data - Weather data retrieved from {@link getWeatherData}.
 * @return {String} The body text.
 */
function constructMMSBody(data) {
  return `\r
Here's your daily weather forecast! 

Today will have a low of ${data.temp[0].min.value}°${data.temp[0].min.units} and a high of ${data.temp[1].max.value}°${data.temp[1].max.units}.
There will be winds of ${data.wind_speed[0].min.value} ${data.wind_speed[0].min.units} bearing ${data.wind_direction[0].min.value} ${data.wind_direction[0].min.units}.`
}

/**
 * Send a weather notification MMS.
 * 
 * @todo 
 */
exports = function(){
  const IS_TESTING = context.values.get('IS_TESTING'); // In-script boolean 'HARDCODE_WEATHER' has been deprecated in favor of a global flag
  
  const twilio = context.services.get('Twilio');
  const http = context.services.get('Weather');
  const mongodb = context.services.get('mongodb-atlas');
  const users = mongodb.db('data').collection(IS_TESTING ? 'test' : 'users');
  
  const TWILIO_SID = IS_TESTING ? context.values.get('TWILIO_TEST_SID') : context.values.get('TWILIO_SID');
  const TWILIO_AUTH_KEY = IS_TESTING ? context.values.get('TWILIO_TEST_AUTH_KEY') : context.values.get('TWILIO_AUTH_KEY');
  const TWILIO_PHONE = IS_TESTING ? context.values.get('TWILIO_TEST_PHONE') : context.values.get('TWILIO_PHONE');
  
  const timeString = getCurrentTime();
  const userFilter = IS_TESTING ? {} : { sendTime: timeString };
  return users.find(userFilter)
    .toArray()
    .then(users => {
      console.log(`Found ${users.length} users matching ${timeString}`);
      users.forEach(user => {
        var { coordinates, sendTime, phone, _id } = user;

        if (!IS_TESTING && (coordinates === undefined || sendTime === undefined || phone === undefined)) { // This should NEVER happen. Database should never have undefined fields
          throw new TypeError(`User ${_id} has invalid fields. Please fix their entry in the database.`)
        }
        
        const [ longitude, latitude ] = coordinates; // WHY IS IT LONGITUDE LATITUDE? 
        
        getWeatherData(latitude, longitude)
          .then(data => {
            const body = constructMMSBody(data);
            const danbooruTag = getTagFromWeatherCondition(data.weather_code);
            getDanbooruImageURL(danbooruTag).then(url => {
              http.post({
                scheme: 'https',
                host: 'api.twilio.com',
                path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
                username: TWILIO_SID,
                password: TWILIO_AUTH_KEY,
                form: {
                  To: phone,
                  From: TWILIO_PHONE,
                  Body: body,
                  MediaUrl: url
                },
                encodeBodyAsJSON: true
              })
              .then(response => {
                const data = EJSON.parse(response.body.text());
                console.log(`Twilio response: ${response.body.text()}`);
              })
              .catch(err => console.error(`Failed to send MMS: ${err}`));
            console.log(`Sent notification to ${phone}`);
          })
          .catch(err => console.error(`Failed to retrieve image URL: ${err}`));
        })
        .catch(err => console.error(`Failed to retrieve weather data: ${err}`));
      });
    })
    .catch(err => console.error(`Failed to enumerate users: ${err}`));
};