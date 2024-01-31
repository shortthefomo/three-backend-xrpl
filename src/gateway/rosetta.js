'use strict'

const EventEmitter = require('events')
// const GatewayDB = require('./persist/db-gateway.js')

const GeoLocate = require('../util/geo.js')
const transactionWindow = require('../util/transaction-window.js')

const Axios = require('axios')
const https = require('https')

const debug = require('debug') 
const log = debug('threexrp:gateway:rosetta')


class Rosetta extends EventEmitter {
	constructor(Config) {
		super()
		const Geo = new GeoLocate()

		let PubsubManager = null
		let AddressData = null
		const windowS = new transactionWindow('stable', 300000)
		const windowF = new transactionWindow('fiat', 300000)
		const windowO = new transactionWindow('others', 300000)

		Object.assign(this, {
			stats() {
				setInterval(() => {
					const queueS = windowS.get_queue()
					const itemsS = queueS.length
					const sumS = queueS.reduce(function(a, b){ return a + b.a }, 0)

					const queueO = windowO.get_queue()
					const itemsO = queueO.length
					const sumO = queueO.reduce(function(a, b){ return a + b.a }, 0)

					const queueF = windowF.get_queue()
					const itemsF = queueF.length
					const sumF = queueF.reduce(function(a, b){ return a + b.a }, 0)
					const stats = {
						s: {
							s: sumS,
							c: itemsS,
							a: sumS/itemsS
						},
						f: {
							s: sumF,
							c: itemsF,
							a: sumF/itemsF
						},
						o: {
							s: sumO,
							c: itemsO,
							a: sumO/itemsO
						},
						t: {
							s: sumS + sumF + sumO,
							c: itemsS + itemsF + + itemsO,
							a: (sumS + sumF + sumO)/(itemsS + itemsF + itemsO)
						}
					}
					PubsubManager.route(stats, 'stats')
					// log('stats', stats.t)
				}, 2000)
			},
			publish(Name, Fiat, Amount, Price, Maker, Type, Debug = false) {
				if (PubsubManager == null) { return }
				let template = {
					'f': '', // fiat
					'a': 0, // amount
					'p': 0, // price
					'm': false, // maker
					't': 0, // time stamp microseconds
					'e': '' //exchange name
				}

				
				template.f = Fiat
				template.a = (Amount * 1)
				template.p = (Price * 1)
				template.m = Maker
				template.s = Type
				template.t = Date.now()
				template.e = Name

				// funky string numbers some times.
				try {
					if (isNaN(template.a)) {
						template.a = (Amount.replace(',','')) *1
						// log(template)
					}
					if (isNaN(template.p)) {
						template.p = (Price.replace(',','')) *1
						// log(template)
					}
				} catch (error) {
					// break out we wont be able to add this info as its not a number
					log('not number')
					log(template)
					return
				}
				
				if (Debug) {
					log(template)
				}

				// adds geolocation data
				if (AddressData != null) {
					template = Geo.append_geolocation_exchange_info(template, AddressData)	
				}
				switch (template.f) {
					case 'BUSD':
					case 'USDC':
					case 'USDT':
					case 'USDD':
					case 'TUSD':
					case 'AUDT':
					case 'EURS':
					case 'XSGD':
					case 'MMXN':
					case 'DAI':
					case 'BIDR':
					case 'FDUSD':
					case 'PYUSD':
						PubsubManager.route(template, 'stable')
						windowS.add({ a: template.a })
						break
					case 'BTC':
					case 'ETH':
					case 'SOL':
					case 'BNB':
						PubsubManager.route(template, 'others')
						windowO.add({ a: template.a })
						break
					default:
						PubsubManager.route(template, 'trade')
						windowF.add({ a: template.a })
						break
				}
			},
			setPubSubManager(manager) {
                PubsubManager = manager
				this.stats()
            },
            async setAddressData() {
				const instance = Axios.create({
                    httpsAgent: new https.Agent({  
                      rejectUnauthorized: false
                    })
                  })
				const {data} = await instance.get(`https://three-backend.panicbot.xyz/api/v3/geo-addresses`)
				for (let index = 0; index < data.length; index++) {
                    data[index].name = data[index].name.replace(/\s+/g, '-').toLowerCase()
                }
				
            	AddressData = []
				for (var i = 0; i < data.length; i++) {
					AddressData[data[i].name] = data[i]
				}
            }
		})
	}
}

module.exports = Rosetta