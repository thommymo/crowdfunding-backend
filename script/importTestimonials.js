//
// This script imports testimonials from a gsheet
// and looks for photos locally at ./photos/
//
// usage
// cf_server  node script/importTestimonials.js
//
require('dotenv').config()

const PgDb = require('../lib/pgdb')
const fetch = require('isomorphic-unfetch')
const gsheets = require('gsheets')
const uploadExoscale = require('../lib/uploadExoscale')
const keyCDN = require('../lib/keyCDN')
const fs = require('fs')
const uuid = require('uuid/v4')
const convertImage = require('../lib/convertImage')


const GKEY = '1IoNowWMs6dK3OAK_uyWaZMQKrWU0H6LCTYedLcbHPXk'

const FOLDER = 'testimonials'
const BUCKET = 'republik'
const { ASSETS_BASE_URL } = process.env
const IMAGE_SIZE_SMALL = convertImage.IMAGE_SIZE_SMALL

PgDb.connect().then( async (pgdb) => {

  let counter = 0

  const sheet = await gsheets.getWorksheet(GKEY, 'live')
  await Promise.all(sheet.data.map( async (person) => {
    if(person.Filename && fs.existsSync(__dirname+'/photos/'+person.Filename)) {
      const names = person.Name.split(' ')

      const filename = person.Filename
      const firstName = names[0]
      const lastName = names.slice(1).join(' ')
      const email = person['E-Mailadresse']
      const quote = person.Statement
      const role = person.Bezeichnung
      let video
      if(person.hls && person.mp4) {
        video = {
          hls: person.hls,
          mp4: person.mp4,
          subtitles: person.subtitles,
          youtube: person.youtube,
        }
      }

      console.log('running for: '+firstName+' '+lastName)

      let user = await pgdb.public.users.findOne({email})
      let testimonial
      if(user) {
        testimonial = await pgdb.public.testimonials.findOne({userId: user.id})
      }

      const id = testimonial ? testimonial.id : uuid()
      const pathOriginal = `/${FOLDER}/${id}_original.jpeg`
      const pathSmall = `/${FOLDER}/${id}_${IMAGE_SIZE_SMALL}x${IMAGE_SIZE_SMALL}.jpeg`

      const image = fs.readFileSync(__dirname+'/photos/'+filename, 'binary')
      const inputBuffer = new Buffer(image, 'binary')

      await Promise.all([
        convertImage.toJPEG(inputBuffer)
          .then( (data) => {
            return uploadExoscale({
              stream: data,
              path: pathOriginal,
              mimeType: 'image/jpeg',
              bucket: BUCKET
            })
          }),
        convertImage.toSmallBW(inputBuffer)
          .then( (data) => {
            return uploadExoscale({
              stream: data,
              path: pathSmall,
              mimeType: 'image/jpeg',
              bucket: BUCKET
            })
          })
      ])

      if(!user) {
        user = await pgdb.public.users.insertAndGet({
          firstName,
          lastName,
          email: email || 'vip@project-r.construction'
        })
      }
      if(!testimonial) {
        await pgdb.public.testimonials.insert({
          id,
          userId: user.id,
          role,
          quote,
          image: ASSETS_BASE_URL+pathSmall,
          video
        }, {skipUndefined: true})
      } else {
        keyCDN.purgeUrls([pathOriginal, pathSmall])
        await pgdb.public.testimonials.updateAndGetOne({id: testimonial.id}, {
          role,
          quote,
          image: ASSETS_BASE_URL+pathSmall,
          video
        }, {skipUndefined: true})
      }
      counter += 1
      console.log('finished: '+firstName+' '+lastName)

    }
  }))
  console.log(`${counter} people imported`)

}).then( () => {
  process.exit()
}).catch( e => {
  console.error(e)
  process.exit(1)
})