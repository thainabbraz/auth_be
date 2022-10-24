const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config");

const moment = require("moment");
const redis = require("ioredis");
const redisClient = redis.createClient({
  port: process.env.REDIS_PORT || 6379,
  host: process.env.REDIS_HOST || "localhost",
});

let WINDOW_SIZE_IN_HOURS;
let MAX_WINDOW_REQUEST_COUNT;
let WINDOW_LOG_INTERVAL_IN_HOURS;

/**
 * Guards are the middleware to "protet" routes.
 **/

/**
 * Make sure the user is logged in
 **/

function ensureUserLoggedIn(req, res, next) {
  let token = _getToken(req);
  if (token == null) return res.sendStatus(401);

  try {
    // Throws error on invalid/missing token
    jwt.verify(token, SECRET_KEY);
    // If we get here, a valid token was passed
    next();
  } catch (err) {
    res.status(401).send({ error: "Unauthorized" });
  }
}

/**
 * Make sure the rate limit is respected
 **/

const redisRateLimiter = async (req, res, next) => {
  redisClient.on("connect", function () {
    console.log("connected");
  });

  try {
    // check that redis client exists
    if (!redisClient) {
      throw new Error("Redis client does not exist!");
    }

    let key = _getToken(req);

    console.log("key: ", key);
    if (key == null) {
      console.log("here for NON auth");
      key = req.ip;
      WINDOW_SIZE_IN_HOURS = 10;
      MAX_WINDOW_REQUEST_COUNT = 100;
      WINDOW_LOG_INTERVAL_IN_HOURS = 1;
    } else {
      console.log("here for auth");
      WINDOW_SIZE_IN_HOURS = 10;
      MAX_WINDOW_REQUEST_COUNT = 200;
      WINDOW_LOG_INTERVAL_IN_HOURS = 1;
    }
    // fetch records of current user using IP or token, returns null when no record is found
    const record = await redisClient.get(key);
    const currentRequestTime = moment();
    console.log("record: ", record);
    //  if no record is found , create a new record for user and store to redis
    if (record == null) {
      let newRecord = [];
      let requestLog = {
        requestTimeStamp: currentRequestTime.unix(),
        requestCount: 1,
      };
      newRecord.push(requestLog);
      await redisClient.set(key, JSON.stringify(newRecord));
      next();
    }
    // if record is found, parse it's value and calculate number of requests users has made within the last window
    let data = [JSON.stringify(record)];
    // data.push();

    let windowStartTimestamp = moment()
      .subtract(WINDOW_SIZE_IN_HOURS, "hours")
      .unix();

    let requestsWithinWindow = data.filter((entry) => {
      return entry.requestTimeStamp > windowStartTimestamp;
    });

    console.log("requestsWithinWindow", requestsWithinWindow);
    let totalWindowRequestsCount = requestsWithinWindow.reduce(
      (accumulator, entry) => {
        return accumulator + entry.requestCount;
      },
      0
    );
    // if number of requests made is greater than or equal to the desired maximum, return error
    if (totalWindowRequestsCount >= MAX_WINDOW_REQUEST_COUNT) {
      //   res.status(429).jsend.error(
      //       `You have exceeded the ${MAX_WINDOW_REQUEST_COUNT} requests in ${WINDOW_SIZE_IN_HOURS} hrs limit!`
      //     );
      res.status(429).send("Too many requests - try again later");
    } else {
      // if number of requests made is less than allowed maximum, log new entry
      let lastRequestLog = data[data.length - 1];
      let potentialCurrentWindowIntervalStartTimeStamp = currentRequestTime
        .subtract(WINDOW_LOG_INTERVAL_IN_HOURS, "hours")
        .unix();
      //  if interval has not passed since last request log, increment counter
      if (
        lastRequestLog.requestTimeStamp >
        potentialCurrentWindowIntervalStartTimeStamp
      ) {
        lastRequestLog.requestCount++;
        data[data.length - 1] = lastRequestLog;
      } else {
        //  if interval has passed, log new entry for current user and timestamp
        data.push({
          requestTimeStamp: currentRequestTime.unix(),
          requestCount: 1,
        });
      }
      await redisClient.set(token, JSON.stringify(data));
      next();
    }
  } catch (error) {
    next(error);
  }
};

function _getToken(req) {
  // Return '' if header not found
  if (!("authorization" in req.headers)) {
    return "";
  }
  // Split header into 'Bearer' and token
  let authHeader = req.headers["authorization"];
  let [str, token] = authHeader.split(" ");

  return str === "Bearer" ? token : "";
}

module.exports = {
  ensureUserLoggedIn,
  redisRateLimiter,
};
