const PgDb = require('./lib/pgdb')
const cors = require('cors')
const express = require('express')
const basicAuth = require('express-basic-auth')
const logger = require('./lib/logger')
const {getFormatter} = require('./lib/translate')
const MESSAGES = require('./lib/translations.json').data
const util = require('util')

const DEV = process.env.NODE_ENV && process.env.NODE_ENV !== 'production'
if (DEV) {
  require('dotenv').config()
}

process.env.PORT = process.env.PORT || 3001

const auth = require('./src/auth')
const graphql = require('./graphql')
const newsletter = require('./src/newsletter')
const requestLog = require('./src/requestLog')
const gsheets = require('./src/gsheets')
const paymentsLog = require('./src/paymentsLog')

const t = getFormatter(MESSAGES)


//crash on unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandled promise rejection', { promise: util.inspect(promise) })
  throw new Error(t('api/unexpected'))
})


PgDb.connect().then( (pgdb) => {
  const server = express()

  //redirect to https
  if (!DEV) {
    server.enable('trust proxy')
    server.use((req, res, next) => {
      if(!req.secure) {
        res.redirect('https://' + req.hostname + req.url)
      }
      return next()
    })
  }

  //fetch needs explicit CORS headers otherwise, cookies are not sent
  if(process.env.CORS_WHITELIST_URL) {
    const corsOptions = {
      origin: process.env.CORS_WHITELIST_URL,
      credentials: true,
      optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
    }
    server.use('*', cors(corsOptions))
  }

  //middleware
  server.use(requestLog)
  server.use(newsletter(t))
  server.use(gsheets(pgdb, logger))
  server.use(paymentsLog(pgdb))

  if (process.env.BASIC_AUTH_PASS) {
    server.use(basicAuth({
      users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASS },
      challenge: true,
      realm: process.env.BASIC_AUTH_REALM
    }))
  }

  // Once DB is available, setup sessions and routes for authentication
  auth.configure({
    server: server,
    secret: process.env.SESSION_SECRET,
    domain: process.env.COOKIE_DOMAIN || undefined,
    dev: DEV,
    pgdb: pgdb,
    t,
    logger
  })

  graphql(server, pgdb, t)

  // start the server
  server.listen(process.env.PORT, () => {
    logger.info('server is running on http://localhost:'+process.env.PORT)
  })
})
