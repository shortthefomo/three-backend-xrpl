'use strict'

const WebSocket = require('ws')
const wssp = new WebSocket.Server({ port: 3131 }) //perMessageDeflate: false
const transactionWindow = require('./transaction-window.js')
const debug = require('debug') 
const log = debug('threexrp:pubsub')

module.exports = class PubSubManager {
	constructor(wss) {
		const subscribers = new transactionWindow('sub', 3600000) // 1 hour

		Object.assign(this, {
			sockets() {
				log('sockets started')
				wss.getUniqueID = function () {
					return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
				}

				wss.on('connection', (ws, req) => {
					// log('req', req)
					ws.on('message', (message) => {
						try {
							const data = JSON.parse(message)
							// log('message', data)
							if ('op' in data) {
								if (data.op === 'ping') {
									ws.last = Date.now()	
								}
								else if (data.op === 'subscribe' && data.channel ==='threexrp') {
									const ip = (req.headers['x-forwarded-for'] != null) ? req.headers['x-forwarded-for'] : req.socket.remoteAddress.split(':')[req.socket.remoteAddress.split(':').length - 1]
									const q = subscribers.get_queue()
									let attempts = 1
									for (let index = 0; index < q.length; index++) {
										const element = q[index]
										if (element.ip !== ip) { continue }
										attempts = element.attempts + 1
										break
									}

									// if (attempts > 40) {
									// 	log('blocked client', ip)
									// 	ws.terminate()
									// 	return
									// }

									ws.id = wss.getUniqueID()
									ws.last = Date.now()
									
									subscribers.add({ id: ws.id,  ip: ip, attempts: attempts})
									log('client connected', ws.id, ip, 'attempts', attempts)
								}
							}
						} catch (error) {
							// nothing
							log('socket error', error)
						}
					})
					ws.on('close', () => {
						//log('client disconnected', ws.id)
						wss.clients.forEach(function each(client) {
							if (ws.id === client.id) {
								client.terminate()
							}
						})
					})
					ws.on('error', (error) => {
						log('SocketServer error')
						log(error)
					})
				})

				wssp.getUniqueID = function () {
					return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
				}
				wssp.on('connection', (ws, req) => {
					ws.on('message', (message) => {
						try {
							// log('data', data)
							const data = JSON.parse(message)
							if (data.op === 'ping') {
								ws.last = Date.now()	
							}
							else if (data.op === 'subscribe' && data.channel ==='public') {
								ws.id = wssp.getUniqueID()
								ws.last = Date.now()
								log('client connected', ws.id)
							}
						} catch (error) {
							// nothing
							log('public socket error', error)
						}
					})
					ws.on('close', () => {
						log('public client disconnected', ws.id)
						wssp.clients.forEach(function each(client) {
							if (ws.id === client.id) {
								client.terminate()
							}
						})
					})
					ws.on('error', (error) => {
						log('SocketServer error')
						log(error)
					})
				})
			},
			route(message, channel) {
				const string = '{"' + channel +'": ' + JSON.stringify(message) + '}'
				const now = Date.now() - 10000
				wss.clients.forEach(function each(client) {
					if (now < client.last) {
						client.send(string)
					}
				})


				if (channel === 'xrpl') { return }
				if ('g' in message) {
					delete message.g
				}
				if ('c' in message) {
					delete message.c
				}
				if ('d' in message) {
					delete message.d
				}
				const public_string = '{"' + channel +'": ' + JSON.stringify(message) + '}'
				wssp.clients.forEach(function each(client) {
					// log('cient id', client.id)
					if (now < client.last) {
						client.send(public_string)
					}
				})
			},
			stats() {
				let c1 = 0, c2 = 0
				wss.clients.forEach(function each(client) {
					//log('client is alive', client.readyState)
					if (Date.now() - 10000 > client.last) {
						// log('client timedout', client.id)
						// client.terminate()
					}
					else {
						c1++
					}
				})
				wssp.clients.forEach(function each(client) {
					if (Date.now() - 10000 > client.last) {
						// log('public client timedout', client.id)
						// client.terminate()
					}
					else {
						c2++
					}
				})
				
				log(`clients: ${c1/2}, pub clients: ${c2}`)
			}
		})
	}
}