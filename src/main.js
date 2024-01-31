'use strict'

// const server = require('http').createServer()
const WebSocketServer = require('ws').Server
const PubSubManager = require('./util/pubsub-v3.js')
const ConnectorGateway = require('./gateway/collector.js')
const Ledger = require('./xrpl/ledger.js')
const debug = require('debug') 
const dotenv = require('dotenv')

const log = debug('threexrp:main')
const EventEmitter = require('events')

dotenv.config()

class main extends EventEmitter {
	constructor(Config) {
		super()

		const GatewayCollector = new ConnectorGateway()
		const LedgerCollector = new Ledger()
		

		const wss = new WebSocketServer({ port: process.env.APP_PORT }) // perMessageDeflate: false
		const Pubsub = new PubSubManager(wss)

		Object.assign(this, {
			start() {
				Pubsub.sockets()
				this.monitorGateways(Pubsub)

				const self = this
				this.addListener('mem-stats', function() {
					self.logAppStats()			
				})
			},
			logAppStats() {
				const usage = process.memoryUsage()
				usage.rss = usage.rss / Math.pow(1000, 2)
				usage.heapTotal = usage.heapTotal / Math.pow(1000, 2)
				usage.heapUsed = usage.heapUsed / Math.pow(1000, 2)
				usage.external = usage.external / Math.pow(1000, 2)
				usage.arrayBuffers = usage.arrayBuffers / Math.pow(1000, 2)

				log(`rss: ${usage.rss} MB, total: ${usage.heapTotal} MB, used: ${usage.heapUsed} MB, external: ${usage.external} MB, arrayBuffers: ${usage.arrayBuffers} MB`)


				Pubsub.stats()
			},
			checkAppMemoryHealth() {
				const self = this
				setInterval(() => {
					self.emit('mem-stats')
				}, 10000)
			},
			monitorGateways(Pubsub) {
				log('monitorGateways starting...')
				
				GatewayCollector.setPubSubManager(Pubsub)
				GatewayCollector.connect()
				LedgerCollector.setPubSubManager(Pubsub)
				LedgerCollector.classifyPayments()
			},
		})
	}
}

const runner = new main()
runner.start()
runner.checkAppMemoryHealth()