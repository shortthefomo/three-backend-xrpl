'use strict'

const Axios = require('axios')
const WebSocket = require('ws')
const EventEmitter = require('events')
const debug = require('debug') 

const log = debug('threexrp:gateway:connector')

class Connector extends EventEmitter {
	constructor(Config) {
		super()

		const BACKOFF_FACTOR = 500
		const FALLOVER_LIMIT_REST = 100
		const FALLOVER_LIMIT_SOCKET = 50

		const Connections = {}

		Object.assign(this, {
			getConnections() {
				return Connections
			},
			publishResult(Name, Fiat = null, emmit = true) {
				const info = { 
					'data': Connections[Name].response_data,
					'connected': Connections[Name].connected,
					'errors': Connections[Name].errors.length, 
					'response_latency': Connections[Name].response_latency,
					'average_latency': Connections[Name].average_latency,
					'last_response': Connections[Name].last_response,
					'name': Connections[Name].Name,
					'fiat': Fiat,
					'endpoint': (Fiat == null) ? null : Connections[Name].connections[Fiat].url,
					'type': Connections[Name].type,
					'interval': (Fiat == null) ? null : Connections[Name].connections[Fiat].interval,
					'skip_first': (Fiat == null) ? null : Connections[Name].connections[Fiat].skip_first,
					'responses': Connections[Name].response_count,
					'start': Connections[Name].start,
					'reconnects': Connections[Name].reconnects,
					'pairs' : Connections[Name].pairs
				}
				

				if (emmit) {
					if (Connections[Name].response_data !== null) {
						this.emit(Connections[Name].Name, info)
					}	
				}
				
				// this.getStats(info)
				// once we consumed it all empty it.
				Connections[Name].response_data = null
			},
			addRestServer(Name, Subscribe) {
				if (Name == null) { return }
				if (!Array.isArray(Subscribe)) { return }

				Connections[Name] = { Name }
				Connections[Name].type = 'REST'
				Connections[Name].connected = true
				Connections[Name].response_count = 0
				Connections[Name].errors = []
				Connections[Name].connections = []
				Connections[Name].back_off_hard = false
				Connections[Name].latency = 0
				Connections[Name].response_latency = 0
				Connections[Name].average_latency = 0
				Connections[Name].last_response = Date.now()
				Connections[Name].start = Date.now()
				Connections[Name].pairs = []
				Connections[Name].response_data = null
				for (var i = 0; i < Subscribe.length; i++) {
					const info = {
						'url' : Subscribe[i].url,
						'fiat' : Subscribe[i].fiat,
						'last_trade_id' : 0,
						'skip_first': false,
						'argument' : null,
						'interval': Subscribe[i].interval
					}
					Connections[Name].pairs.push(Subscribe[i].fiat)
					Connections[Name].connections[Subscribe[i].fiat] = info
				}
				log('subscribed', Name + ' REST')
			},
			setLastTradeID(Name, Fiat, ID) {
				if (Name == null) { return }
				if (Fiat == null) { return }
				if (ID == null) { return }
				Connections[Name].connections[Fiat].last_trade_id = ID
			},
			getLastTradeID(Name, Fiat) {
				if (Name == null) { return }
				if (Fiat == null) { return }
				
				return Connections[Name].connections[Fiat].last_trade_id
			},
			setArguments(Name, Fiat, Argument) {
				if (Name == null) { return }
				if (Fiat == null) { return }

				Connections[Name].connections[Fiat].argument = Argument
			},
			pollServer(Name) {
				if (Name == null) { return }		

				for (const [Fiat, value] of Object.entries(Connections[Name].connections)) {
					this.setupInstance(Name, Fiat)
					this.startPolling(Name, Fiat)
				}
			},
			setupInstance(Name, Fiat) {
				// We have pulled the plug on this endpoint
				if (!Connections[Name].connected) { return }
				// Stop polling once we reach our limit
				if (Connections[Name].errors.length > FALLOVER_LIMIT_REST) { 
					Connections[Name].connected = false
					return 
				}

				const self = this,
				nextTick = function(Name, Fiat) {
					Connections[Name].latency = Date.now()

					let endpoint = Connections[Name].connections[Fiat].url
					if (Connections[Name].connections[Fiat].argument != null) {
					 	endpoint += Connections[Name].connections[Fiat].argument
					}

					Axios.get(endpoint)
						.then(function (response) {
							Connections[Name].response_data = response.data
						})
						.catch(function (error) {
							// handle error
							Connections[Name].connected = false
							// if (error?.response?.status < 500) {
							// 	// disconnect serious issue
							// 	Connections[Name].back_off_hard = true
							// }

							log(`REST fetch error ${Name}`, error?.response?.status)
						})
						.then(function () {
							// always executed
							Connections[Name].connected = true
							Connections[Name].response_count ++
							Connections[Name].response_latency = Date.now() - Connections[Name].last_response
							Connections[Name].average_latency = self.averageValue(Name)
							Connections[Name].last_response = Date.now()
							self.publishResult(Name, Fiat)

							Connections[Name].connections[Fiat].skip_first = true
							self.startPolling(Name, Fiat)
						})
				}
				this.addListener('nextTick-' + Name + '-' + Fiat, function(Name, Fiat) {
					nextTick(Name, Fiat)				
				})
			},
			averageValue(Name) {
				const current = Date.now() - Connections[Name].last_response
				const count = Connections[Name].response_count
				const average_latency = Connections[Name].average_latency

				return average_latency + ((current - average_latency) / count)
			},
			startPolling(Name, Fiat) {
				if (Name == null) { return }
				if (Fiat == null) { return }
				let interval = Connections[Name].connections[Fiat].interval + (BACKOFF_FACTOR * Connections[Name].errors.length)
				if (Connections[Name].back_off_hard) {
					interval += 2000
				}
				const self = this
				setTimeout(function() {
					self.emit('nextTick-' + Name + '-' + Fiat, Name, Fiat)
				}, interval)
			},

			addNonStandard(Name, Pairs) {
				if (Name == null) { return }
				if (Pairs == null) { return }
				log('subscribed ' + Name + ' NonStandard')

				Connections[Name] = { Name }	
				Connections[Name].type = 'NonStandard'
				Connections[Name].connected = true
				Connections[Name].errors = []
				Connections[Name].reconnects = 0
				Connections[Name].response_count = 0
				Connections[Name].response_latency = 0
				Connections[Name].average_latency = 0
				Connections[Name].url = ''
				Connections[Name].pairs = Pairs
				Connections[Name].start = Date.now()
				Connections[Name].last_response = Date.now()
			},
			// getNonStandardConnection(Name) {
			// 	if (Name == null) { return }
			// 	return Connections[Name]
			// },
			// setNonStandardConnection(Name, connection) {
			// 	if (Name == null) { return }
			// 	if (connection == null) { return }
			// 	return Connections[Name] = connection
			// },
			getSocket(Name) {
				return Connections[Name].socket
			},
			newSocket(Name, URL, Headers) {
				if (Headers == null) {
					Connections[Name].socket = new WebSocket(URL)
				}
				else {
					Connections[Name].socket = new WebSocket(URL, Headers)
				}
			},
			addWebSocket(Name, URL, Pairs, Subscribe = [], Headers = null) {
				if (Name == null) { return }
				if (URL == null) { return }
				if (Pairs == null) { return }
				if (!Array.isArray(Subscribe)) { return }


				Connections[Name] = { Name }
				this.newSocket(Name, URL, Headers)

				Connections[Name].type = 'WebSocket'
				Connections[Name].errors = []
				Connections[Name].headers = Headers
				Connections[Name].connected = false
				Connections[Name].pullplug = false
				Connections[Name].pullplug_time = 0
				Connections[Name].reconnects = 0
				Connections[Name].response_count = 0
				Connections[Name].response_latency = 0
				Connections[Name].average_latency = 0
				Connections[Name].response_data = null
				Connections[Name].url = URL
				Connections[Name].pairs = Pairs
				Connections[Name].start = Date.now()
				Connections[Name].subscribe = Subscribe
				Connections[Name].last_response = Date.now()
				this.openWebSocket(Name)
			},
			async waitForOpenConnection(socket, name) {
                return new Promise((resolve, reject) => {
                    const maxNumberOfAttempts = 100
                    const intervalTime = 200 //ms

                    let currentAttempt = 0
                    const interval = setInterval(() => {
                        if (currentAttempt > maxNumberOfAttempts - 1) {
                            clearInterval(interval)
                            reject(new Error(`Maximum number of attempts exceeded ${name}`))
                        } else if (socket.readyState == 1) {
                            clearInterval(interval)
                            resolve()
                        }
                        currentAttempt++
                    }, intervalTime)
                })
            },
			openWebSocket(Name) {
				if (Name == null) { return }

				const self = this,
				ErrorCodes = {
					'1000': 'Normal Closure',
					'1001': 'Going Away',
					'1002': 'Protocol Error',
					'1003': 'Unsupported Data',
					'1004': '(For future)',
					'1005': 'No Status Received',
					'1006': 'Abnormal Closure',
					'1007': 'Invalid frame payload data',
					'1008': 'Policy Violation',
					'1009': 'Message too big',
					'1010': 'Missing Extension',
					'1011': 'Internal Error',
					'1012': 'Service Restart',
					'1013': 'Try Again Later',
					'1014': 'Bad Gateway',
					'1015': 'TLS Handshake'
				}
				try {
					Connections[Name].socket.on('open', function (message) {
						Connections[Name].last_response = Date.now()
						Connections[Name].subscribe.forEach(async function (ConnectionString, i) {
							await self.waitForOpenConnection(Connections[Name].socket, Name)
							if (Connections[Name].socket.readyState === 1) {
								Connections[Name].socket.send(JSON.stringify(ConnectionString))
							}
							else {
								Connections[Name].pullplug = true
								Connections[Name].pullplug_time = Date.now()
								Connections[Name].socket.terminate()
								Connections[Name].connected = false
							}
						})
						log('subscribed', Name + ' ' + Connections[Name].type)
						self.publishResult(Name)
					})

					Connections[Name].socket.on('close', function (message) {
						log('close ' + Name, message)
						Connections[Name].last_response = Date.now()
						if (message.toString().includes('Error: Unexpected server response:')) {
							log('Pulled plug on: ' + Name)
							Connections[Name].pullplug = true
							Connections[Name].pullplug_time = Date.now()
							Connections[Name].socket.terminate()
						}
						Connections[Name].connected = false
						if (message in ErrorCodes) {
							message = ErrorCodes[message]
						}
						Connections[Name].errors.push(message)
						// dont reconnect serious error
						if (!Connections[Name].pullplug) {
							self.reconnectSocket(Name)	
						}
						
						self.publishResult(Name)
					})

					Connections[Name].socket.on('error', function (error) {
						log('error ' + Name, error)

						if (error.toString().includes('Error: Unexpected server response:')) {
							log('Pulled plug on: ' + Name)
							Connections[Name].pullplug = true
							Connections[Name].pullplug_time = Date.now()
							Connections[Name].socket.terminate()
						}
						
						Connections[Name].last_response = Date.now()
						if (ErrorCodes[error] != null) {
							Connections[Name].errors.push(ErrorCodes[error])
						}
						else {
							Connections[Name].errors.push({'error_code': '500'})
						}
						self.publishResult(Name)
						//Connections[Name].socket = null
					})

					Connections[Name].socket.on('message', function (message) {
						Connections[Name].response_count ++
						Connections[Name].response_latency = Date.now() - Connections[Name].last_response
						Connections[Name].average_latency = self.averageValue(Name)
						Connections[Name].last_response = Date.now()
						Connections[Name].connected = true
						Connections[Name].response_data = message
						self.publishResult(Name)
					})
				} catch(error) {
					Connections[Name].connected = false
					Connections[Name].errors.push(error)
					log('Closed connection to: ' + Name)
					log(error)
				}
			},
			// getStats(data) {
			// 	delete data.data
			// 	this.emit('stats', data)
			// },
			send(Name, data) {
				Connections[Name].socket.send(data)
			},
			listenHeartBeat(Name) {
				// do not stack listeners here!!!! 
				this.addListener('heartbeat-' + Name, function() {
					if (!('heartbeat' in Connections[Name])) { return }
					if (Connections[Name].connected) {
						if (Connections[Name].heartbeat == 'PING') {
							Connections[Name].socket.ping()
						}
						else {
							Connections[Name].socket.send(Connections[Name].heartbeat)
						}
						//log('ping..... ' + Name)
					}
				})
			},
			setHeartBeat(Name, Message, Interval = 10000) {
				if (Name == null) { return }

				Connections[Name].heartbeat = Message
				
				const self = this
				// check if we are polling or not
				if (Interval == false) {
					self.emit('heartbeat-' + Name)
					return
				}
				setInterval(function() {
					// log('heartbeat-' + Name)
					self.emit('heartbeat-' + Name)
				}, Interval)
			},
			reconnectSocket(Name, forced = false) {
				let self = this
				if (Name == null) { return }
				if (forced) {
					setTimeout(function() {
						log('reconnecting', Name)
						self.newSocket(Name, Connections[Name].url, Connections[Name].headers)
						self.emit('reconnect', Name)
						return
					}, 500)
				}

				setTimeout(function() {
					if (!Connections[Name].connected && !Connections[Name].pullplug) {
						log('Reconnecting Socket 1: ' + Name)
						self.newSocket(Name, Connections[Name].url, Connections[Name].headers)
						Connections[Name].reconnects ++

						self.emit('reconnect', Name)
					}
				}, 300000 + (BACKOFF_FACTOR * Connections[Name].errors.length)) //only retry after 5 min.
			},
			reconnectFalloverSocket() {
				const self = this
				setTimeout(function() {
					for (const [Name, value] of Object.entries(Connections)) {
						if (Connections[Name].pullplug) {
							if (Date.now() - Connections[Name].pullplug_time > 300000)  {
								log('Reconnecting Fallover Socket: ' + Name)
								self.newSocket(Name, Connections[Name].url, Connections[Name].headers)

								// clear out errors
								Connections[Name].errors = []
								Connections[Name].reconnects ++
								Connections[Name].pullplug = false

								self.emit('reconnect', Name)
							}
						}
						else if (!Connections[Name].connected) {
							log('Reconnecting Socket 2: ' + Name)
							self.newSocket(Name, Connections[Name].url, Connections[Name].headers)
							Connections[Name].reconnects ++

							self.emit('reconnect', Name)
						}
					}
				}, 600000) // try again after 10 min
			},
			listenReconnectSocket() {
				log('addListener reconnect: ')
				this.addListener('reconnect', function(Name) {
					if (!Connections[Name].connected) {
						this.openWebSocket(Name)
					}
				})
				this.reconnectFalloverSocket()
			}
		})
    }    
}

module.exports = Connector