'use strict'

const Kucoin = require('kucoin-websocket-api')

const pako = require('pako')
const zlib = require('zlib')
const io = require("socket.io-client")

const TradeConnector = require('./connector.js')
const TradeRosetta = require('./rosetta.js')
const debug = require('debug') 
const dotenv = require('dotenv')

const log = debug('threexrp:gateway:collector')

module.exports = class Collector {
    constructor(Config) {
        dotenv.config()
 
    	let PubsubManager = null
    	const Connector = new TradeConnector()
		const Rosetta = new TradeRosetta()
        Rosetta.setAddressData() // initilize the address data

        Object.assign(this, {
        	connect() {
        		Connector.listenReconnectSocket()
                Connector.reconnectFalloverSocket()

                const local = (process.env.ENV == 'dev') ? true : false
                // this.test()
                this.connectSockets()
                this.connectSocketsStable()
                this.oneOffs()
                this.pollRest()
            },
        	setPubSubManager(manager) {
                PubsubManager = manager
                Rosetta.setPubSubManager(manager)
            },
            socketStats() {
                Connector.pollingStats()
                Connector.on('connection-stats', () => {
                    const stats = Connector.publishStats()
                    //console.log(stats)
                    PubsubManager.route(stats, 'stats')
                    Connector.pollingStats()
                })
            },
            connectSockets() {
                let subscribe = []
                const debug = false
                const id = Date.now()
                const type = 'socket'

                subscribe = [{
                    'type': 'subscribe',
                    'payload': {
                        'channels': [
                            {
                                'name': 'all_trades',
                                'symbols': ['XRPUSDT']
                            }
                        ]
                    }
                }]
                Connector.addWebSocket('delta-exchange', 'wss://socket.delta.exchange', ['USDT'], subscribe)
                // Connector.listenHeartBeat('delta-exchange')
                Connector.on('delta-exchange', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.type !== 'all_trades') { return }
                    const maker = (data.seller_role == 'maker') ? true:false
                    Rosetta.publish('delta-exchange', data.symbol.substring('XRP'.length), data.size, data.price, maker, type, debug)
                })

                subscribe = [{
                'method': 'subscribeTrades',
                    'params': {
                        'symbol': 'XRPUSDT',
                        'limit': 10
                    },
                    'id': id
                }, {
                    'method': 'subscribeTrades',
                    'params': {
                        'symbol': 'XRPEURS',
                        'limit': 10
                    },
                    'id': id
                }, {
                    'method': 'subscribeTrades',
                    'params': {
                        'symbol': 'XRPBTC',
                        'limit': 10
                    },
                    'id': id
                }, {
                    'method': 'subscribeTrades',
                    'params': {
                        'symbol': 'XRPETH',
                        'limit': 10
                    },
                    'id': id
                }]
                Connector.addWebSocket('cryptomkt', 'wss://api.exchange.cryptomkt.com/api/2/ws/public', ['USDT', 'EURS', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('cryptomkt')
                Connector.on('cryptomkt', (message) => {
                    const data = JSON.parse(message.data)
                    
                    if (data.method !== 'updateTrades') { return }
                    data.params.data.forEach((trade, i) => {
                        const maker = (trade.side == 'sell') ? true:false
                        Rosetta.publish('cryptomkt', data.params.symbol.substring('XRP'.length), trade.quantity, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{
                    'action': 'subscribe-public',
                    'module': 'trading',
                    'path': 'transactions/XRP-USDT'
                   }, {
                    'action': 'subscribe-public',
                    'module': 'trading',
                    'path': 'transactions/XRP-USDC'
                   }, {
                    'action': 'subscribe-public',
                    'module': 'trading',
                    'path': 'transactions/XRP-EUR'
                   }, {
                    'action': 'subscribe-public',
                    'module': 'trading',
                    'path': 'transactions/XRP-PLN'
                   }, {
                    'action': 'subscribe-public',
                    'module': 'trading',
                    'path': 'transactions/XRP-BTC'
                   }]
                Connector.addWebSocket('zonda', 'wss://api.zondacrypto.exchange/websocket/', ['USDT', 'USDC', 'EUR', 'PLN', 'BTC'], subscribe)
                Connector.listenHeartBeat('zonda')
                Connector.on('zonda', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.action !== 'push') { return }
                    if (!('transactions' in data.message)) { return }
                    data.message.transactions.forEach((trade, i) => {
                        const maker = (trade.ty == 'Sell') ? true:false
                        Rosetta.publish('zonda', data.topic.substring('trading/transactions/xrp-'.length).toUpperCase(), trade.a, trade.r, maker, type, debug)
                    })
                })

                subscribe = [{ 'op': 'sub', 'id': id, 'ch':'trades:XRP/USDT' }, { 'op': 'sub', 'id': id, 'ch':'trades:XRP/USD' }, { 'op': 'sub', 'id': id, 'ch':'trades:XRP/BTC' }]
                Connector.addWebSocket('ascendex', 'wss://ascendex.com/1/api/pro/v1/stream', ['USDT'], subscribe)
                Connector.listenHeartBeat('ascendex')
                Connector.on('ascendex', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.m === 'ping') { 
                        Connector.setHeartBeat('ascendex', JSON.stringify({'op': 'pong' }), false)
                        return 
                    }
                    if (data.m !== 'trades') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.bm == true) ? true:false
                        Rosetta.publish('ascendex', data.symbol.substring('XRP/'.length), trade.q, trade.p, maker, type, debug)
                    })
                })

                subscribe = [{
                    'event':'sub',
                    'params':{
                        'channel': 'market_xrpusdt_trade_ticker',
                        'cb_id': id
                    }
                }]
                Connector.addWebSocket('cointiger', 'wss://api.cointiger.com/exchange-market/ws', ['USDT'], subscribe)
                Connector.listenHeartBeat('cointiger')
                Connector.on('cointiger', (message) => {
                    let pakodata = new Uint8Array(message.data)
                    const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                    if ('ping' in data) {    
                        Connector.setHeartBeat('cointiger', JSON.stringify({ 'pong': data.ping }), false)
                        return
                    }
                    if (!('tick' in data)) { return }
                    data.tick.data.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        const string = data.channel.substring('market_xrp'.length).toUpperCase()
                        const token = string.substring( 0, string.indexOf('_TRADE_TICKER'))
                        Rosetta.publish('cointiger', token, trade.amount, trade.price, maker, type, debug)
                    })
                })
                
                subscribe = [{
                    'event':'subscribe',
                    'symbol':'XRP/EUR',
                    'subscription':{'name':'public-trades'}
                }]
                Connector.addWebSocket('bit2me', 'wss://ws.bit2me.com/v1/trading', ['EUR'], subscribe)
                // Connector.listenHeartBeat('bequant')
                // Connector.setHeartBeat('bequant', JSON.stringify({'method': 'server.ping', 'params': [], 'id': id }), 10000)
                Connector.on('bit2me', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.event !== 'public-trades') { return }
                    const maker = (data.data.side == 'sell') ? true:false
                    Rosetta.publish('bit2me', data.symbol.substring('XRP/'.length), data.data.amount, data.data.price, maker, type, debug)
                })

                subscribe = [{
                    'method': 'subscribe',
                    'ch': 'trades',
                    'params': {
                        'symbols': ['XRPUSD', 'XRPEUR', 'XRPGBP', 'XRPBTC', 'XRPETH', 'XRPUSDT', 'XRPEURS', 'XRPDAI'],
                        'limit': 1
                    },
                    'id': id
                }]
                Connector.addWebSocket('bequant', 'wss://api.bequant.io/api/3/ws/public', ['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT', 'EURS', 'DAI'], subscribe)
                // Connector.listenHeartBeat('bequant')
                // Connector.setHeartBeat('bequant', JSON.stringify({'method': 'server.ping', 'params': [], 'id': id }), 10000)
                Connector.on('bequant', (message) => {
                    const data = JSON.parse(message.data)
                    
                    if (data.ch !== 'trades') { return }
                    if (!('update' in data) ){ return }
                    for (const [key, value] of Object.entries(data.update)) {
                        value.forEach((trade, i) => {
                            const maker = (trade.s == 'sell') ? true:false
                            Rosetta.publish('bequant', key.substring('XRP'.length), trade.q, trade.p, maker, type, debug)
                        })
                    }
                })

                subscribe = [{
                    'method':'deals.subscribe',
                    'params':
                      [
                        'XRP_USDT',
                        'XRP_BUSD',
                        'XRP_USDC',
                        'XRP_BTC',
                        'XRP_ETH'
                      ],
                    'id':id
                  }]
                Connector.addWebSocket('tidex', 'wss://ws.tidex.com/', ['USDT', 'BSDT', 'USDC', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('tidex')
                Connector.setHeartBeat('tidex', JSON.stringify({'method': 'server.ping', 'params': [], 'id': id }), 10000)
                Connector.on('tidex', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.method !== 'deals.update') { return }
                    data.params[1].forEach((trade, i) => {
                        const maker = (trade.type == 'sell') ? true:false
                        Rosetta.publish('tidex', data.params[0].substring('XRP_'.length), trade.amount, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{
                    'method':'deals.subscribe',
                    'params':
                      [
                        'XRP_USDT',
                        'XRP_BTC'
                      ],
                    'id':id
                  }]
                Connector.addWebSocket('localtrade', 'wss://localtrade.cc/ws', ['USDT', 'BTC'], subscribe)
                Connector.listenHeartBeat('localtrade')
                Connector.setHeartBeat('localtrade', JSON.stringify({'method': 'server.ping', 'params': [], 'id': id }), 10000)
                Connector.on('localtrade', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.method !== 'deals.update') { return }
                    data.params[1].forEach((trade, i) => {
                        const maker = (trade.type == 'sell') ? true:false
                        Rosetta.publish('localtrade', data.params[0].substring('XRP_'.length), trade.amount, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{
                    'method': 'subscribe',
                    'ch': 'trades',
                    'params': {
                        'symbols': ['XRPUSDT', 'XRPUSDC','XRPDAI', 'XRPBTC', 'XRPETH']
                    },
                    'id': id
                }]
                Connector.addWebSocket('changelly', 'wss://api.pro.changelly.com/api/3/ws/public', ['USDT', 'USDC', 'DAI', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('changelly')
                Connector.on('changelly', (message) => {
                    const data = JSON.parse(message.data)
                    
                    if (!('update' in data)) { return }
                    if (data.ch !== 'trades') { return }
                    
                    for (const [key, value] of Object.entries(data.update)) {
                        value.forEach((trade, i) => {
                            const maker = (trade.s == 'sell') ? true:false
                            Rosetta.publish('changelly', key.substring('XRP'.length), trade.q, trade.p, maker, type, debug)
                        })
                    }
                })

                subscribe = [{
                    'op':'subscribe',
                    'args':[
                      {
                        'instType':'mc',
                        'channel':'trade',
                        'instId':'XRPBTC'
                      }, {
                        'instType':'mc',
                        'channel':'trade',
                        'instId':'XRPETH'
                      }, {
                        'instType':'mc',
                        'channel':'trade',
                        'instId':'XRPUSDT'
                      }, {
                        'instType':'mc',
                        'channel':'trade',
                        'instId':'XRPUSDC'
                      }
                    ]
                  }]
                Connector.addWebSocket('bitget', 'wss://ws.bitget.com/mix/v1/stream', ['BTC', 'ETH', 'USDT', 'USDC'], subscribe)
                Connector.listenHeartBeat('bitget')
                Connector.setHeartBeat('bitget', 'ping', 5000)
                Connector.on('bitget', (message) => {
                        if (message.data === 'pong') { return }
                        const data = JSON.parse(message.data)
                        if (data.action !== 'update') { return }
                        data.data.forEach((trade, i) => {
                            const maker = (trade[3] == 'sell') ? true:false
                            Rosetta.publish('bitget-global', data.arg.instId.substring('XRP'.length), trade[2], trade[1], maker, type, debug)
                        })
                    
                })

                subscribe = [{
                    'symbol': 'XRPUSDT',
                    'topic':  'trade',
                    'event': 'sub'
                },{
                    'symbol': 'XRPUSDC',
                    'topic':  'trade',
                    'event': 'sub'
                },{
                    'symbol': 'XRPBTC',
                    'topic':  'trade',
                    'event': 'sub'
                },{
                    'symbol': 'XRPMMXN',
                    'topic':  'trade',
                    'event': 'sub'
                }]
                Connector.addWebSocket('trubit', 'wss://ws.trubit.com/openapi/quote/ws/v1', ['USDT', 'USDC', 'BTC', 'MMXN'], subscribe)
                Connector.listenHeartBeat('trubit')
                Connector.setHeartBeat('trubit', JSON.stringify({ 'ping': new Date().getTime() }), 100000)
                Connector.on('trubit', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        if (data.data === undefined) { return }
                        
                        data.data.forEach((trade, i) => {
                            const maker = (trade.m == false) ? true:false
                            Rosetta.publish('trubit', data.symbol.substring('XRP'.length), trade.q, trade.p, maker, type, debug)
                        })
                    } catch (error) {
                        log('trubit error', error)
                    }
                })

                subscribe = [{
                    'op': 'SUBSCRIBE',
                    'topic':  'TRADE', 
                    'symbol': 'XRP_USDT'
                },{
                    'op': 'SUBSCRIBE',
                    'topic':  'TRADE', 
                    'symbol': 'XRP_BTC'
                }]
                Connector.addWebSocket('pionex', 'wss://ws.pionex.com/wsPub', ['USDT', 'BTC'], subscribe)
                Connector.listenHeartBeat('pionex')
                Connector.on('pionex', (message) => {
                    const data = JSON.parse(message.data)
                    if ('type' in data) { return }
                    if ('op' in data) {
                        // log(data)
                        Connector.setHeartBeat('pionex', JSON.stringify({'op': 'PONG', 'timestamp': data.timestamp }), false)
                        return
                    }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        Rosetta.publish('pionex', trade.symbol.substring('XRP_'.length), trade.size, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{
                    'method': 'subscribe', 
                    'topics': ['trade@XRP_BRL', 'trade@XRP_MXN', 'trade@XRP_USDC'] 
                  }]
                Connector.addWebSocket('ripio-trade', 'wss://ws.ripiotrade.co', ['BRL'], subscribe)
                Connector.on('ripio-trade', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('body' in data)) { return }
                    const maker = (data.body.taker_side === 'sell') ? true:false
                    Rosetta.publish('ripio-trade', data.body.pair.substring('XRP_'.length), data.body.amount, data.body.price, maker, type, debug)
                })

                subscribe = [{
                    op: 'subscribe',
                    args: ['trade']
                }]
                Connector.addWebSocket('exir', 'https://api.exir.io/stream', ['IRR', 'USDT'], subscribe)
                Connector.listenHeartBeat('exir')
                Connector.setHeartBeat('exir', JSON.stringify({ op: 'ping' }), 100000)
                Connector.on('exir', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.symbol !== 'xrp-usdt' && data.symbol !== 'xrp-irt') { return }
                    if (data.action !== 'insert') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.side == 'sell') ? true:false
                        const fiat = data.symbol.substring('xrp-'.length).toUpperCase() === 'IRT' ? 'IRR': data.symbol.substring('xrp-'.length).toUpperCase()
                        Rosetta.publish('exir', fiat, trade.size, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{
                    'i': 1,
                    'n': 'SubscribeToTradingPair',
                    'o': {
                      'tradingPairName': 'XRP-KRW'
                    }
                  },{
                    'i': 1,
                    'n': 'SubscribeToTradingPair',
                    'o': {
                      'tradingPairName': 'XRP-USDC'
                    }
                  
                }]
                Connector.addWebSocket('gopax', 'wss://wsapi.gopax.co.kr', ['KRW'], subscribe)
                Connector.listenHeartBeat('gopax')
                Connector.on('gopax', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n === 'OrderBookEvent') {return}
                    if (message.data.substring(1, 'primus::ping::'.length +1) === 'primus::ping::') {
                        Connector.setHeartBeat('gopax', JSON.stringify('primus::pong::' + data.substring('primus::ping::'.length)), false)
                    }                   
                    if (data.n !== 'PublicTradeEvent') {return}
                    const maker = (data.o.isBuy === false) ? true:false
                    Rosetta.publish('gopax', data.o.tradingPairName.substring('XRP-'.length), data.o.baseAmount, data.o.price, maker, type, debug)
                })
                
                subscribe = [{
                    'type': 'subscribe',
                    'channel': 'spotTrades.XRP_EUR',
                    'request_id': 'three-eur-' + id
                  },{
                    'type': 'subscribe',
                    'channel': 'spotTrades.XRP_USD',
                    'request_id': 'three-usd-' + id
                  },{
                    'type': 'subscribe',
                    'channel': 'spotTrades.XRP_BTC',
                    'request_id': 'three-btc-' + id
                  }]
                Connector.addWebSocket('cryptology', 'wss://octopus.cryptology.com/v1/connect', ['EUR', 'USD', 'BTC'], subscribe)
                Connector.on('cryptology', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.type !== 'subscriptionData') { return }

                    data.payload.data.forEach(function (trade, index) {
                        const maker = (trade.taker_order_type == 'SELL') ? true:false
                        Rosetta.publish('cryptology', trade.trade_pair.substring('XRP_'.length), trade.amount, trade.price, maker, type, debug)
                     })
                })

                // subscribe = [{'op': 'subscribe', 'channel': 'marketHistory_BTC-INR'}, {'op': 'subscribe', 'channel': 'marketHistory_XRP-INR'}]
                // Connector.addWebSocket('buyucoin', 'wss://ws.buyucoin.com/market', ['INR'], subscribe)
                // Connector.listenHeartBeat('buyucoin')
                // Connector.setHeartBeat('buyucoin', JSON.stringify({'op': 'ping'}), 10000)
                // Connector.on('buyucoin', (message) => {
                //     const data = JSON.parse(message.data)
                //     log(data)
                //     if (data.nsp === 'subscribed') { return }
                //     if ('pong' in data) { return }
                //     const maker = (data.data.side == 'sell') ? true:false
                //     Rosetta.publish('buyucoin', 'INR', data.data.size, data.data.price, maker, type, debug)
                // })

                subscribe = [{ 'symbol': 'XRPUSDT', 'topic': 'trade', 'event': 'sub', 'params': { 'binary': false } }]
                Connector.addWebSocket('toobit', 'wss://stream.toobit.com/quote/ws/v1', ['USDT'], subscribe)
                Connector.listenHeartBeat('toobit')
                Connector.setHeartBeat('toobit', 'ping', 100000)
                Connector.on('toobit', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.topic !== 'trade') { return }
                    // log(data)
                    data.data.forEach((trade, i) => {
                        const maker = (trade.m == false) ? true:false
                        Rosetta.publish('toobit', data.symbol.substring(3, 7).toUpperCase(), trade.q, trade.p, maker, type, debug)
                    })
                })

                subscribe = [{'type': 'subscribe', 'product_ids': [ 'XRP-USD', 'XRP-EUR', 'XRP-GBP', 'XRP-USDT' ], 'channels': [ 'matches', 'heartbeat', { 'name': 'matches', 'product_ids': [ 'XRP-USD', 'XRP-EUR', 'XRP-GBP', 'XRP-USDT' ]}] }]
                Connector.addWebSocket('coinbase', 'wss://ws-feed.exchange.coinbase.com', ['USD', 'EUR', 'GBP', 'USDT'], subscribe)
                Connector.on('coinbase', (message) => {
                    const data = JSON.parse(message.data)
                    // console.log('data', data)
                    if (!('type' in data)) { return }
                    if (data.type != 'match') { return }

                    const maker = (data.side == 'buy') ? true:false
                    Rosetta.publish('coinbase', data.product_id.substring('XRP-'.length).toUpperCase(), data.size, data.price, maker, type, debug)
                })

                const osmid_ndax = JSON.stringify({ OMSId: 1, InstrumentId: 4, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_ndax}]
                Connector.addWebSocket('ndax', 'wss://api.ndax.io/WSGateway/', ['CAD'], subscribe)
                // https://github.com/NDAXlO/ndax-api-documentation
                Connector.listenHeartBeat('ndax')
                Connector.setHeartBeat('ndax', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('ndax', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('ndax', 'CAD', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                const osmid_ndax_usd = JSON.stringify({ OMSId: 1, InstrumentId: 110, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_ndax_usd}]
                Connector.addWebSocket('ndax-usd', 'wss://api.ndax.io/WSGateway/', ['USD'], subscribe)
                // https://github.com/NDAXlO/ndax-api-documentation
                Connector.listenHeartBeat('ndax-usd')
                Connector.setHeartBeat('ndax-usd', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('ndax-usd', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('ndax', 'USD', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                subscribe = [{ marketIds: ['XRP-AUD'], channels: ['trade', 'heartbeat'], messageType: 'subscribe' }]
                Connector.addWebSocket('btc-markets', 'wss://socket.btcmarkets.net/v2', ['AUD'], subscribe)
                Connector.on('btc-markets', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('messageType' in data)) { return }
                    if (data.messageType != 'trade') { return }

                    const maker = (data.type != 'Bid') ? true:false 
                    Rosetta.publish('btc-markets', data.marketId.substring('XRP-'.length), data.volume, data.price, maker, type, debug) 
                })

                subscribe = [{ 'command': 'subscribe', 'channel': 'trades', 'symbol': 'XRP_JPY'}]
                Connector.addWebSocket('gmo-coin', 'wss://api.coin.z.com/ws/public/v1', ['JPY'], subscribe)
                Connector.on('gmo-coin', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.channel != 'trades') { return }
                    //console.log(data)
                    const maker = (data.side == 'SELL') ? true:false
                    Rosetta.publish('gmo-coin', data.symbol.substring('XRP_'.length), data.size, data.price, maker, type, debug)
                })

                // subscribe = [{ 'sub': 'market.xrpusdt.trade.detail', 'id': id }]
                // Connector.addWebSocket('huobi-kr', 'wss://api-cloud.huobi.co.kr/ws', ['KRW', 'USDT', 'USDC', 'HUSD'], subscribe)
                // Connector.listenHeartBeat('huobi-kr')
                // Connector.on('huobi-kr', (message) => {
                    
                //     let pakodata = new Uint8Array(message.data)
                //     const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                //     // log(data)
                //     if ('ping' in data) {
                //         // respond to ping
                //         Connector.setHeartBeat('huobi-kr', JSON.stringify({'pong': data.ping}), false)
                //     }
                //     if ('tick' in data) {
                //         // console.log(data.tick)
                //         data.tick.data.forEach((trade, i) => {
                //             const mm = data.ch.substring(7, data.ch.length).split('.')[0]
                //             const maker = (trade.direction == 'sell') ? true:false
                //             Rosetta.publish('huobi-global', mm.substring(3, mm.length).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                //         })
                //     }
                // })

                /// this skip still lets stuff through :/ ignoring for now
                let btseSkip = true
                let btseLast = {
                    'USD': 0,
                    'EUR': 0,
                    'GBP': 0,
                    'MYR': 0,
                    'HKD': 0,
                    'INR': 0,
                    'JPY': 0,
                    'SGD': 0,
                    'USDT': 0,
                    'USDC': 0,
                    'FDUSD': 0,
                }

                subscribe = [
                    {'op': 'subscribe', 'args': [
                        'tradeHistoryApi:XRP-USD', 
                        'tradeHistoryApi:XRP-EUR', 
                        'tradeHistoryApi:XRP-GBP', 
                        'tradeHistoryApi:XRP-MYR', 
                        'tradeHistoryApi:XRP-HKD', 
                        'tradeHistoryApi:XRP-INR', 
                        'tradeHistoryApi:XRP-JPY', 
                        'tradeHistoryApi:XRP-SGD', 
                        'tradeHistoryApi:XRP-USDT', 
                        'tradeHistoryApi:XRP-USDC',
                        'tradeHistoryApi:XRP-FDUSD']
                    }
                ]

                Connector.addWebSocket('btse', 'wss://ws.btse.com/ws/spot', ['USD', 'EUR', 'GBP', 'MYR', 'HKD', 'INR', 'JPY', 'SGD', 'USDT', 'USDC', 'FDUSD'], subscribe)
                Connector.listenHeartBeat('btse')
                Connector.setHeartBeat('btse', 'PING', 20000)
                Connector.on('btse', (message) => {
                    const data = JSON.parse(message.data)
                    // log(data)
                    if (data.event == 'subscribe') { return }
                    if (!btseSkip) {
                        data.data.reverse().forEach(function (trade, index) {
                            if (trade.tradeId > btseLast[trade.symbol.substring('XRP-'.length)]) {
                                const maker = (trade.side == 'SELL') ? true:false
                                Rosetta.publish('btse', trade.symbol.substring('XRP-'.length), trade.size, trade.price, maker, type, debug)
                                btseLast[trade.symbol.substring('XRP-'.length)] = trade.tradeId
                            }
                        })
                    }
                    btseSkip = false
                })

                subscribe = [{ 'sub': 'market.xrpjpy.trade.detail', 'id': id }]
                Connector.addWebSocket('huobi-global', 'wss://api-cloud.bittrade.co.jp/ws', ['JPY'], subscribe)
                Connector.listenHeartBeat('huobi-global')
                Connector.on('huobi-global', (message) => {
                    let pakodata = new Uint8Array(message.data)
                    const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                    if ('ping' in data) {
                        // respoind to ping
                        Connector.setHeartBeat('huobi-global', JSON.stringify({'pong': data.ping}), false)
                    }
                    if ('tick' in data) {
                        data.tick.data.forEach((trade, i) => {
                            const mm = data.ch.substring(7, data.ch.length).split('.')[0]
                            const maker = (trade.direction == 'sell') ? true:false
                            Rosetta.publish('huobi-global', mm.substring(3, mm.length).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                        })
                    }
                })

                subscribe = [
                    { 'sub': 'market.xrpusdt.trade.detail', 'id': id },
                    { 'sub': 'market.xrpusdc.trade.detail', 'id': id },
                    { 'sub': 'market.xrpusdd.trade.detail', 'id': id },
                    { 'sub': 'market.xrpbtc.trade.detail', 'id': id },
                ]
                Connector.addWebSocket('huobi-pro', 'wss://api.huobi.pro/ws', ['USDT', 'USDC', 'USDD', 'BTC'], subscribe)
                Connector.listenHeartBeat('huobi-pro')
                Connector.on('huobi-pro', (message) => {
                    let pakodata = new Uint8Array(message.data)
                    const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                    if ('ping' in data) {
                        // respoind to ping
                        Connector.setHeartBeat('huobi-pro', JSON.stringify({'pong': data.ping}), false)
                    }
                    if ('tick' in data) {
                        data.tick.data.forEach((trade, i) => {
                            const mm = data.ch.substring(7, data.ch.length).split('.')[0]
                            const maker = (trade.direction == 'sell') ? true:false
                            Rosetta.publish('huobi-global', mm.substring(3, mm.length).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                        })
                    }
                })

                subscribe = [{m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_usdt'})}]
                Connector.addWebSocket('bitazza_usdt', 'wss://apexapi.bitazza.com/WSGateway/', ['USDT'], subscribe)
                Connector.listenHeartBeat('bitazza_usdt')
                Connector.setHeartBeat('bitazza_usdt', JSON.stringify({m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_usdt'})}), 10000)
                let bitazzaUSDTID = 0
                let bitazzaUSDTSkip = false
                Connector.on('bitazza_usdt', (message) => {
                    let data = JSON.parse(message.data)
                    data = JSON.parse(data.o)
                    if (!Array.isArray(data)) { return }
                    data.forEach(function (trade, index) {
                        const maker = (trade.type == 'sell') ? true:false
                        if (bitazzaUSDTID < trade.trade_id) {
                            bitazzaUSDTID = trade.trade_id
                            if (bitazzaUSDTSkip) {
                                Rosetta.publish('bitazza', 'USDT', trade.quote_volume, trade.price, maker, type, debug)     
                            }
                        }
                    })
                    bitazzaUSDTSkip = true
                })

                subscribe = [{m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_btc'})}]
                Connector.addWebSocket('bitazza_usdt', 'wss://apexapi.bitazza.com/WSGateway/', ['BTC'], subscribe)
                Connector.listenHeartBeat('bitazza_usdt')
                Connector.setHeartBeat('bitazza_usdt', JSON.stringify({m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_usdt'})}), 10000)
                let bitazzaBTCID = 0
                let bitazzaBTCSkip = false
                Connector.on('bitazza_usdt', (message) => {
                    let data = JSON.parse(message.data)
                    data = JSON.parse(data.o)
                    if (!Array.isArray(data)) { return }
                    data.forEach(function (trade, index) {
                        const maker = (trade.type == 'sell') ? true:false
                        if (bitazzaBTCID < trade.trade_id) {
                            bitazzaBTCID = trade.trade_id
                            if (bitazzaBTCSkip) {
                                Rosetta.publish('bitazza', 'USDT', trade.quote_volume, trade.price, maker, type, debug)     
                            }
                        }
                    })
                    bitazzaBTCSkip = true
                })
                


                subscribe = [{m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_thb'})}]
                Connector.addWebSocket('bitazza', 'wss://apexapi.bitazza.com/WSGateway/', ['THB'], subscribe)
                Connector.listenHeartBeat('bitazza')
                Connector.setHeartBeat('bitazza', JSON.stringify({m: 0, i: 0, n: 'Trades', o: JSON.stringify({'market_pair': 'xrp_thb'})}), 10000)
                let bitazzaID = 0
                let bitazzaSkip = false
                Connector.on('bitazza', (message) => {
                    let data = JSON.parse(message.data)
                    data = JSON.parse(data.o)
                    if (!Array.isArray(data)) { return}
                    data.forEach(function (trade, index) {
                        const maker = (trade.type == 'sell') ? true:false
                        if (bitazzaID < trade.trade_id) {
                            bitazzaID = trade.trade_id
                            if (bitazzaSkip) {
                                Rosetta.publish('bitazza', 'THB', trade.quote_volume, trade.price, maker, type, debug)     
                            }
                        }
                    })
                    bitazzaSkip = true
                })

                subscribe = [{'event':'subscribe', 'data':{'channel':'trades-XRP_EUR'}}, {'event':'subscribe', 'data':{'channel':'trades-XRP_CZK'}}, {'event':'subscribe', 'data':{'channel':'trades-XRP_BTC'}}]
                Connector.addWebSocket('coinmate', 'wss://coinmate.io/api/websocket', ['EUR', 'CZK', 'BTC'], subscribe)
                Connector.listenHeartBeat('coinmate')
                Connector.on('coinmate', (message) => {
                    
                    if (message.data.includes('subscribe_success')) { return }
                    if (message.data.includes('ping')) {
                        Connector.setHeartBeat('coinmate', JSON.stringify({'event': 'pong'}), false)
                        return 
                    }
                    const data = JSON.parse(message.data)
                    if (data.event != 'data') { return }
                    data.payload.forEach(function (trade, index) {
                        const maker = (trade.type == 'SELL') ? true:false
                        Rosetta.publish('coinmate', data.channel.substring('trades-XRP_'.length), trade.amount, trade.price, maker, type, debug)
                    })
                })

                // subscribe = [{type: "subscribe", channel: "xrp_jpy-trades"}]
                // Connector.addWebSocket('coincheck', 'wss://ws-api.coincheck.com/', subscribe)
                // Connector.on('coincheck', (message) => {
                    
                //     if (!message.data.includes('xrp_jpy')) { return }
                //     const data = JSON.parse(message.data)
                //     console.log(message)
                //     const maker = (data[4] == 'sell') ? true:false
                //     Rosetta.publish('coincheck', data[1].substring(4, 7), data[3], data[2], maker, type, debug)
                // })

                subscribe = [
                    {'cmd':1,'action':'sub','symbol':'xrp_usdt'},
                    {'cmd':1,'action':'sub','symbol':'xrp_usdc'},
                    {'cmd':1,'action':'sub','symbol':'xrp_btc'},
                    {'cmd':1,'action':'sub','symbol':'xrp_eth'}
                ]
                Connector.addWebSocket('aex', 'wss://api.aex.zone/wsv3', ['USDT', 'USDC', 'BTC', 'ETH'], subscribe)
                Connector.on('aex', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.cmd == 0) { return }
                    if (data.action == 'sub') { return }
                    if (!('trade'in data)) { return }

                    data.trade.forEach((trade, i) => {
                        const maker = (trade[3] == 'sell') ? true:false
                        Rosetta.publish('aex', data.symbol.substring('xrp_'.length).toUpperCase(), trade[1], trade[2], maker, type, debug)
                    })
                })
                Connector.listenHeartBeat('aex')
                Connector.setHeartBeat('aex', JSON.stringify({'cmd': 'ping'}), 10000)

                // subscribe = [{'action': 'subscribe', 'channel': 'trades', 'symbol': 'XRP-USD'},
                //     {'action': 'subscribe', 'channel': 'trades', 'symbol': 'XRP-EUR'}]
                // Connector.addWebSocket('blockchain-exchange', 'wss://ws.prod.blockchain.info/mercury-gateway/v1/ws', ['USD', 'EUR'], subscribe, { headers : { 'origin': 'https://Connector.blockchain.com' }})
                // Connector.on('blockchain-exchange', (message) => {
                //     if (!message.data.includes('timestamp')) { return }
                //     const data = JSON.parse(message.data)
                //     const maker = (data.side == 'sell') ? true:false
                //     Rosetta.publish('blockchain-exchange', data.symbol.substring(4, 7), data.qty, data.price, maker, type, debug)
                // })

                subscribe = [{ 'action': 'subscribe', 'channels': [{ 'name': 'trades', 'markets': ['XRP-EUR', 'XRP-BTC']}] }]
                Connector.addWebSocket('bitvavo', 'wss://ws.bitvavo.com/v2/', ['EUR', 'BTC'], subscribe)
                Connector.on('bitvavo', (message) => {
                    if (message.data.includes('subscribed')) { return }
                    const data = JSON.parse(message.data)
                    const maker = (data.side == 'sell') ? true:false
                    Rosetta.publish('bitvavo', data.market.substring(4, 7), data.amount, data.price, maker, type, debug)
                })

                subscribe = [{'id': Date.now(), 'method': 'subscribe', 'topics': [ 'spot/trades:XRP_RUB', 'spot/trades:XRP_USD', 'spot/trades:XRP_UAH', 'spot/trades:XRP_EUR', 'spot/trades:XRP_GBP', 'spot/trades:XRP_USDT', 'spot/trades:XRP_BTC', 'spot/trades:XRP_ETH'] }]
                Connector.addWebSocket('exmo', 'wss://ws-api.exmo.com:443/v1/public', ['RUB', 'USD', 'UAH', 'EUR', 'GBP', 'USDT', 'BTC', 'ETH'], subscribe)
                Connector.on('exmo', (message) => {
                    const data = JSON.parse(message.data)
                    if (data == null) { return }
                    if (!('data'  in data)) { return }
                    if (data.event == 'subscribed') { return }
                    if (data.event == 'info') { return }
                    
                        
                    data.data.forEach(function (trade, index) {
                       const maker = (trade.type == 'sell') ? true:false
                       Rosetta.publish('exmo', data.topic.substring('spot/trades:XRP_'.length), trade.quantity, trade.price, maker, type, debug) 
                    })
                })

                subscribe = []
                Connector.addWebSocket('bitkub', 'wss://api.bitkub.com/websocket-api/market.trade.thb_xrp', ['THB'], subscribe, false)
                Connector.on('bitkub', (message) => {
                    if (message.data.charAt(0) != '{') { return }
                    try {
                        const data = JSON.parse(message.data)
                        const maker = (data.sid != null) ? true:false
                        // none provided in data
                        Rosetta.publish('bitkub', 'THB', data.amt, data.rat, maker, type, debug)
                    } catch (error) {
                        //this endpoint has invalid json
                    }
                })

                subscribe = [{ 'type': 'SUBSCRIBE', 'channels': [{ 'name': 'PRICE_TICKS', 'instrument_codes': [ 'XRP_EUR', 'XRP_CHF'] }] }]
                Connector.addWebSocket('bitpanda', 'wss://streams.exchange.bitpanda.com', ['CHF', 'EUR'], subscribe)
                Connector.on('bitpanda', (message) => {
                    if (message.data.includes('HEARTBEAT')) { return }
                    if (message.data.includes('PRICE_TICK_HISTORY')) { return }
                    if (message.data.includes('SUBSCRIPTIONS')) { return }
              
                    const data = JSON.parse(message.data)
                    const maker = (data.taker_side == 'SELL') ? true:false
                    Rosetta.publish('bitpanda', data.instrument_code.substring('XRP_'.length), data.amount, data.price, maker, type, debug)
                })

                // this one throws Error: Unexpected server response: 503
                // also node:events:371 throw er; // Unhandled 'error' event

                // un-catch-able
                subscribe = [{'event': 'subscribe', 'channel': 'trades', 'symbol': 'tXRPBTC'}]
                Connector.addWebSocket('bitfinex-2', 'wss://api-pub.bitfinex.com/ws/2', ['BTC'], subscribe)
                Connector.on('bitfinex-2', (message) => {

                    if (!message.data.includes('"tu"') && !message.data.includes('"te"')) { return }
                    const data = JSON.parse(message.data)
                    const maker = (data[2][3] < 0) ? true:false
                    Rosetta.publish('bitfinex', 'BTC', Math.abs(data[2][2]), data[2][3], maker, type, debug)
                })

                subscribe = [{'type':'subscribe', 'channel':'marketdata' , 'market_id':'XRP-USDT', 'interval':100, 'filter':['recent_trades']}, 
                    {'type':'subscribe', 'channel':'marketdata' , 'market_id':'XRP-BTC', 'interval':100, 'filter':['recent_trades']}]
                Connector.addWebSocket('probit', 'wss://api.probit.com/api/exchange/v1/ws', ['USDT', 'BTC'], subscribe)
                Connector.on('probit', (message) => {
                if (message.data.includes('pong')) { return }
                    const data = JSON.parse(message.data)
                    
                    if (data.reset == true) { return }
                    if ('recent_trades' in data) {
                        data.recent_trades.forEach(function (trade, index) {
                            const maker = (trade.side == 'sell') ? true:false
                            Rosetta.publish('probit', trade.id.substring(4, trade.id.length).split(':')[0], trade.quantity, trade.price, maker, type, false)
                        })
                    }
                })

                subscribe = [{'event':'subscribe', 'subscription': { 'name':'trade' }, 'pair':['XRP/AUD', 'XRP/CAD', 'XRP/EUR', 'XRP/GBP', 'XRP/JPY', 'XRP/USD', 'XRP/USDT', 'XRP/BTC', 'XRP/ETH']}]
                Connector.addWebSocket('kraken', 'wss://ws.kraken.com', ['AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'USD', 'USDT', 'BTC', 'ETH'], subscribe)
                Connector.on('kraken', (message) => {
                    const data = JSON.parse(message.data)

                    if (data.event == 'subscriptionStatus') { return }
                    if (data.event == 'heartbeat') { return }
                    if (data.event == 'systemStatus') { return }
                    const trades = data[1]
                    // console.log(trade)
                    const pair = data[3]
                    trades.forEach(function (trade, index) {
                        const maker = (trade[3] == 's') ? true:false
                        const tradePair = pair.substring('XRP/'.length).toUpperCase() === 'XBT' ? 'BTC' : pair.substring('XRP/'.length).toUpperCase()
                        Rosetta.publish('kraken', tradePair, trade[1], trade[0], maker, type, debug)
                    })
                })

                subscribe = [{ 'type': 'SUBSCRIBE', 'subscriptions': [{ 'event': 'NEW_TRADE', 'pairs': ['XRPZAR', 'XRPUSDC', 'XRPUSDT', 'XRPBTC', 'XRPETH'] }] }]
                Connector.addWebSocket('valr', 'wss://api.valr.com/ws/trade', ['ZAR', 'USDC', 'USDT', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('valr')
                Connector.setHeartBeat('valr', JSON.stringify({'type': 'PING'}), 10000)
                Connector.on('valr', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.type == 'PUBLIC_WEBSOCKET_TIMEOUT_EXCEEDED') {
                        // use hard reconnect as this is a shit show!
                        Connector.reconnectSocket('valr', true)
                    } 
                    if (data.type != 'NEW_TRADE') { return }
                    // log(data)

                    if (data.data == null) { return }
                    const trade = data.data
                    const maker = (trade.takerSide == 'sell') ? true:false
                    Rosetta.publish('valr', data.currencyPairSymbol.substring('XRP'.length), trade.quantity, trade.price, maker, type, debug) 
                })

                subscribe = [{'event': 'pusher:subscribe', 'data': {'channel': 'execution_details_cash_xrpeur'}},
                    {'event': 'pusher:subscribe', 'data': {'channel': 'execution_details_cash_xrpidr'}},
                    {'event': 'pusher:subscribe', 'data': {'channel': 'execution_details_cash_xrpjpy'}},
                    {'event': 'pusher:subscribe', 'data': {'channel': 'execution_details_cash_xrpusd'}},
                    {'event': 'pusher:subscribe', 'data': {'channel': 'execution_details_cash_xrpsgd'}}]
                Connector.addWebSocket('liquid', 'wss://tap.liquid.com/app/LiquidTapClient', ['EUR', 'IDR', 'JPY', 'USD', 'SGD'], subscribe)
                Connector.on('liquid', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.channel == undefined) { return }
                    if (data.event == 'pusher_internal:subscription_succeeded') { return }
                    const trade = JSON.parse(data.data)
                    const pair = data.channel.substring('execution_details_cash_'.length)
                    const maker = (trade.taker_side == 'sell') ? true:false
                    Rosetta.publish('liquid', pair.substring('XRP'.length).toUpperCase(), trade.quantity, trade.price, maker, type, debug)
                })

                subscribe = [{ 'event': 'bts:subscribe', 'data': { 'channel': 'live_trades_xrpeur' }},
                { 'event': 'bts:subscribe', 'data': { 'channel': 'live_trades_xrpgbp' }},
                { 'event': 'bts:subscribe', 'data': { 'channel': 'live_trades_xrpusd' }},
                { 'event': 'bts:subscribe', 'data': { 'channel': 'live_trades_xrpusdt' }},
                { 'event': 'bts:subscribe', 'data': { 'channel': 'live_trades_xrpbtc' }}]
                Connector.addWebSocket('bitstamp', 'wss://ws.bitstamp.net', ['USD', 'EUR', 'GBP', 'USDT', 'BTC'], subscribe)
                Connector.on('bitstamp', (message) => {
                    if (message.data.includes('subscription_succeeded')) { return }
                    const data = JSON.parse(message.data)
                    const maker = (data.data.type == 0) ? true:false
                    Rosetta.publish('bitstamp', data.channel.substring('live_trades_xrp'.length).toUpperCase(), data.data.amount, data.data.price, maker, type, debug)
                })

                subscribe = [[151, { type: 151, channel: 'trade', event: 'XRPTRY', join: true }]]
                Connector.addWebSocket('btcturk', 'wss://ws-feed-pro.btcturk.com/', ['TRY'], subscribe)
                Connector.on('btcturk', (message) => {
                    if (!message.data.includes('422')) { return }
                    if (message.data.includes('items')) { return }
                    const data = JSON.parse(message.data)
                    const trade = data.pop()
                    const maker = (trade.S == 0) ? true:false
                    Rosetta.publish('btcturk', trade.PS.substring('XRP'.length), trade.A, trade.P, maker, type, debug)            
                })

                const osmid = JSON.stringify({ OMSId: 1, InstrumentId: 10, IncludeLastCount: 20 })

                subscribe = [{m: 2, i: 1, n: 'SubscribeTrades', o: osmid}]
                Connector.addWebSocket('foxbit', 'wss://api.foxbit.com.br/', ['BRL'], subscribe)
                // this end point geet hardly any data and has no heartbeat so we just request something every now and then
                Connector.listenHeartBeat('foxbit')
                Connector.setHeartBeat('foxbit', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('foxbit', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    trades.forEach(function (trade, index) {
                       const maker = (trade[7] == 'sell') ? true:false
                       Rosetta.publish('foxbit', 'BRL', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                const osmid_usdt = JSON.stringify({ OMSId: 1, InstrumentId: 90, IncludeLastCount: 20 })
                subscribe = [{m: 2, i: 1, n: 'SubscribeTrades', o: osmid_usdt}]
                Connector.addWebSocket('foxbit-usdt', 'wss://api.foxbit.com.br/', ['USDT'], subscribe)
                // this end point geet hardly any data and has no heartbeat so we just request something every now and then
                Connector.listenHeartBeat('foxbit-usdt')
                Connector.setHeartBeat('foxbit-usdt', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('foxbit-usdt', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    trades.forEach(function (trade, index) {
                       const maker = (trade[7] == 'sell') ? true:false
                       Rosetta.publish('foxbit', 'USDT', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                const osmid_usdc = JSON.stringify({ OMSId: 1, InstrumentId: 96, IncludeLastCount: 20 })
                subscribe = [{m: 2, i: 1, n: 'SubscribeTrades', o: osmid_usdc}]
                Connector.addWebSocket('foxbit-usdc', 'wss://api.foxbit.com.br/', ['USDC'], subscribe)
                // this end point geet hardly any data and has no heartbeat so we just request something every now and then
                Connector.listenHeartBeat('foxbit-usdc')
                Connector.setHeartBeat('foxbit-usdc', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('foxbit-usdc', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    trades.forEach(function (trade, index) {
                       const maker = (trade[7] == 'sell') ? true:false
                       Rosetta.publish('foxbit', 'USDC', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                const osmid_btc = JSON.stringify({ OMSId: 1, InstrumentId: 100, IncludeLastCount: 20 })
                subscribe = [{m: 2, i: 1, n: 'SubscribeTrades', o: osmid_btc}]
                Connector.addWebSocket('foxbit-btc', 'wss://api.foxbit.com.br/', ['BTC'], subscribe)
                // this end point geet hardly any data and has no heartbeat so we just request something every now and then
                Connector.listenHeartBeat('foxbit-btc')
                Connector.setHeartBeat('foxbit-btc', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('foxbit-btc', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    trades.forEach(function (trade, index) {
                       const maker = (trade[7] == 'sell') ? true:false
                       Rosetta.publish('foxbit', 'BTC', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                subscribe = [
                    {'Event': 'Subscribe', 'Data': ['ticker-xrp-usd']}, 
                    {'Event': 'Subscribe', 'Data': ['ticker-xrp-aud']}, 
                    {'Event': 'Subscribe', 'Data': ['ticker-xrp-nzd']}, 
                    {'Event': 'Subscribe', 'Data': ['ticker-xrp-sgd']},
                    {'Event': 'Subscribe', 'Data': ['ticker-xrp-usdt']}]
                Connector.addWebSocket('independent-reserve', 'wss://websockets.independentreserve.com', ['USD', 'AUD', 'NZD', 'SGD', 'USDT'], subscribe)
                Connector.on('independent-reserve', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.Event == 'Heartbeat') { return }
                    if (data.Event == 'Subscriptions') { return }
                    if (data.Channel != 'ticker-' + data.Data.Pair) { return }

                    const maker = (data.Data.Side == 'Sell') ? true:false
                    Rosetta.publish('independent-reserve', data.Data.Pair.substring('xrp-'.length).toUpperCase(), data.Data.Volume, data.Data.Price, maker, type, debug) 
                })

                // subscribe = [
                //     {'op': 'subscribe', 'channel': 'trades', 'market': 'XRP/USD' }, 
                //     {'op': 'subscribe', 'channel': 'trades', 'market': 'XRP/JPY' },
                //     {'op': 'subscribe', 'channel': 'trades', 'market': 'XRP/USDT' }]
                // Connector.addWebSocket('ftx', 'wss://ftx.com/ws/', ['USD', 'JPY', 'USDT'], subscribe)
                // Connector.listenHeartBeat('ftx')
                // Connector.setHeartBeat('ftx', JSON.stringify({'op': 'ping'}), 10000)
                // Connector.on('ftx', (message) => {
                //     const data = JSON.parse(message.data)
                //     if (data.type == 'subscribed') { return }
                //     if (data.type == 'pong') { return }
                //     if (data.data == null) { return }
                //     data.data.forEach(function (trade, index) {
                //        const maker = (trade.side == 'sell') ? true:false
                //        Rosetta.publish('ftx', data.market.substring('XRP/'.length), trade.size, trade.price, maker, type, debug) 
                //     })
                // })

                subscribe = [
                    { 'action': 'subscribe-public', 'module': 'trading', 'path': 'transactions/XRP-PLN' },
                    { 'action': 'subscribe-public', 'module': 'trading', 'path': 'transactions/XRP-EUR' },
                    { 'action': 'subscribe-public', 'module': 'trading', 'path': 'transactions/XRP-USDT' }]
                Connector.addWebSocket('bitbay', 'wss://api.zonda.exchange/websocket/', ['PLN', 'EUR', 'USDT'], subscribe)
                Connector.on('bitbay', (message) => {
                    
                    if (message.data.includes('subscribe-public-confirm')){ return }
                    if (!message.data.includes('push')) { return }

                    const data = JSON.parse(message.data)
                    data.message.transactions.forEach((trade, i) => {
                        const maker = (trade.ty == 'Sell') ? true:false
                        Rosetta.publish('bitbay', data.topic.substring('trading/transactions/xrp-'.length).toUpperCase(), trade.a, trade.r, maker, type, debug)
                    })
                })

                subscribe = [{ 'accessToken': null, 'timestamp': Date.now(), 'event': 'korbit:subscribe', 'data': {'channels' : ['transaction:xrp_krw']} }]
                Connector.addWebSocket('korbit', 'wss://ws.korbit.co.kr/v1/user/push', ['KRW'], subscribe)
                Connector.on('korbit', (message) => {
                    
                    const data = JSON.parse(message.data)
                    // console.log(data)
                    if (data.event == 'korbit:connected') { return }
                    if (data.event == 'korbit:subscribe') { return }
                    if (data.event != 'korbit:push-transaction') { return }

                    const maker = (data.data.taker == 'sell') ? true:false
                    Rosetta.publish('korbit', data.data.currency_pair.substring('xrp_'.length).toUpperCase(), data.data.amount, data.data.price, maker, type, debug) 
                })

                subscribe = [{ 'id': id, 'method': 'trade.subscribe', 'params': ['sXRPUSDC'] }, { 'id': id, 'method': 'trade.subscribe', 'params': ['sXRPUSDT'] }]
                Connector.addWebSocket('phemex', 'wss://phemex.com/ws', ['USDC', 'USDT'], subscribe)
                Connector.listenHeartBeat('phemex')
                Connector.setHeartBeat('phemex', JSON.stringify({'id': id, 'method': 'server.ping', 'params': [] }), 20000)
                Connector.on('phemex', (message) => {
                    if (message.data.includes('"result":{"status":"success"}}')){ return }
                    if (message.data.includes('pong')){ return }
                    if (message.data.includes('error')){ return }
                    if (!message.data.includes('"type":"incremental"')){ return } // dont consume that initial chunk they send us
                    const data = JSON.parse(message.data)
                    data.trades.forEach((trade, i) => {
                        const maker = (trade[1] == 'Sell') ? true:false
                        // they provide a scaled price.... https://github.com/phemex/phemex-api-docs/blob/master/Public-Spot-API-en.md#tradesub
                        Rosetta.publish('phemex', data.symbol.substring('sXRP'.length), parseFloat(trade[3]/100_000_000), trade[2] / 100_000_000, maker, type, debug)
                    })
                })

                subscribe = [{ action: 'subscribe', book: 'xrp_ars', type: 'trades' }, { action: 'subscribe', book: 'xrp_brl', type: 'trades' }, { action: 'subscribe', book: 'xrp_cop', type: 'trades' }, { action: 'subscribe', book: 'xrp_mxn', type: 'trades' }, { action: 'subscribe', book: 'xrp_usd', type: 'trades' }, { action: 'subscribe', book: 'xrp_btc', type: 'trades' }, , { action: 'subscribe', book: 'xrp_usdt', type: 'trades' }]
                Connector.addWebSocket('bitso', 'wss://ws.bitso.com', ['ARS', 'BRL', 'COP', 'MXN', 'USD', 'BTC', 'USDT'], subscribe)
                Connector.on('bitso', (message) => {
                    if (!message.data.includes('trades')) { return }
                    if(message.data.includes('subscribe')){ return }
                    const data = JSON.parse(message.data)
                    // console.log(data)
                    data.payload.forEach((trade, i) => {
                        const maker = (trade.t == 1) ? true:false
                        Rosetta.publish('bitso', data.book.substring('xrp_'.length).toUpperCase(), trade.a, trade.r, maker, type, debug)
                    })
                })


                subscribe = [[{'ticket': 'xrpl-rosetta'},{'type':'trade', 'codes':['KRW-XRP', 'THB-XRP', 'IDR-XRP', 'USDT-XRP', 'USDC-XRP', 'BTC-XRP']} ,{ 'format':'SIMPLE' }]]
                Connector.addWebSocket('upbit', 'wss://api.upbit.com/websocket/v1', ['KRW', 'THB', 'IDR', 'USDT', 'USDC', 'BTC'], subscribe)
                Connector.on('upbit', (message) => {
                    const data = JSON.parse(message.data)
                    if ('status' in data) { return }
                    const maker = (data.ab == 'BID') ? true:false
                    Rosetta.publish('upbit', data.cd.substring(0, data.cd.length - 4), data.tv, data.tp, maker, type, debug)
                })
                Connector.listenHeartBeat('upbit')
                Connector.setHeartBeat('upbit', 'PING', 5000)

                subscribe = [{ 'method': 'SUBSCRIBE', 'params': ['xrpaud@trade', 'xrpbrl@trade', 'xrpngn@trade', 'xrprub@trade', 'xrpusd@trade', 'xrptry@trade', 'xrpgbp@trade', 'xrpeur@trade', 'xrpusdt@trade', 'xrpusdc@trade', 'xrpbusd@trade', 'xrptusd@trade', 'xrpbidr@trade', 'xrpbtc@trade', 'xrpeth@trade', 'xrpbnb@trade'], 'id': id}]      
                Connector.addWebSocket('binance', 'wss://stream.binance.com:443/ws', ['AUD', 'BRL', 'NGN', 'RUB', 'USD', 'TRY', 'GBP', 'EUR', 'USDT', 'USDC', 'BUSD', 'TUSD', 'BIDR', 'BTC', 'ETH', 'BNB'], subscribe)
                Connector.on('binance', (message) => {
                    if (!message.data.includes('trade')) { return }
                    const data = JSON.parse(message.data)
                    Rosetta.publish('binance', data.s.substring('XRP'.length), data.q, data.p, data.m, type, debug)
                })

                subscribe = [{ 'method': 'SUBSCRIBE', 'params': ['xrpusd@trade', 'xrpusdt@trade', 'xrpusdc@trade', 'xrpbusd@trade', 'xrptusd@trade'], 'id': id}]      
                Connector.addWebSocket('binance-us', 'wss://stream.binance.us:9443/ws', ['USD', 'USDT', 'USDC', 'BUSD', 'TUSD', ''], subscribe)
                Connector.on('binance-us', (message) => {
                    if (!message.data.includes('trade')) { return }
                    const data = JSON.parse(message.data)
                    Rosetta.publish('binance', data.s.substring('XRP'.length), data.q, data.p, data.m, type, debug)
                })

                subscribe = [{ 'method': 'SUBSCRIBE', 'params': ['xrptry@trade', 'xrpusdt@trade', 'xrpbusd@trade'], 'id': id}]      
                Connector.addWebSocket('binance-tr', 'wss://stream-cloud.trbinance.com/ws', ['TRY', 'USDT', 'BUSD'], subscribe)
                Connector.on('binance-tr', (message) => {
                    if (!message.data.includes('trade')) { return }
                    const data = JSON.parse(message.data)
                    Rosetta.publish('binance', data.s.substring('XRP'.length), data.q, data.p, data.m, type, debug)
                })

                subscribe = [{
                    'time': Date.now(),
                    'channel':'spot.trades',
                    'event': 'subscribe',
                    'payload':['XRP_USD', 'XRP_TRY', 'XRP_USDT', 'XRP_BTC']
                }]
                Connector.addWebSocket('gate', 'wss://api.gateio.ws/ws/v4/', ['USD', 'TRY', 'USDT', 'BTC'], subscribe)
                Connector.listenHeartBeat('gate')
                Connector.setHeartBeat('gate', 'PING', 30000)
                Connector.on('gate', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('event' in data)) { return }
                    if (data.event != 'update') { return }
                    
                    const maker = (data.result.side == 'buy') ? true:false
                    Rosetta.publish('gate', data.result.currency_pair.substring('XRP_'.length), data.result.amount, data.result.price, maker, type, debug)
                })


                subscribe = [{
                    'api_key_id': process.env.VUE_APP_LUNO_APIKEY,
                    'api_key_secret': process.env.VUE_APP_LUNO_SECRETKEY
                }]
                Connector.addWebSocket('luno-btc', 'wss://ws.luno.com/api/1/stream/XRPXBT', ['BTC'], subscribe)
                Connector.listenHeartBeat('luno-btc')
                Connector.setHeartBeat('luno-btc', JSON.stringify({}), 10000)
                Connector.on('luno-btc', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.trade_updates == null) { return }
                    if (data.trade_updates.length <= 0) { return }
                    
                    data.trade_updates.forEach(function (trade, index) {
                        const maker = false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                        Rosetta.publish('luno', 'BTC', trade.base, trade.counter / trade.base, maker, type, debug) 
                    })
                })
                
                Connector.addWebSocket('luno-zar', 'wss://ws.luno.com/api/1/stream/XRPZAR', ['ZAR'], subscribe)
                Connector.listenHeartBeat('luno-zar')
                Connector.setHeartBeat('luno-zar', JSON.stringify({}), 10000)
                Connector.on('luno-zar', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.trade_updates == null) { return }
                    if (data.trade_updates.length <= 0) { return }
                    
                    data.trade_updates.forEach(function (trade, index) {
                        const maker = false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                        Rosetta.publish('luno', 'ZAR', trade.base, trade.counter / trade.base, maker, type, debug) 
                    })
                })

                Connector.addWebSocket('luno-ngn', 'wss://ws.luno.com/api/1/stream/XRPNGN', ['NGN'], subscribe)
                Connector.listenHeartBeat('luno-ngn')
                Connector.setHeartBeat('luno-ngn', JSON.stringify({}), 10000)
                Connector.on('luno-ngn', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.trade_updates == null) { return }
                    if (data.trade_updates.length <= 0) { return }
                    
                    data.trade_updates.forEach(function (trade, index) {
                        const maker = false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                        Rosetta.publish('luno', 'NGN', trade.base, trade.counter / trade.base, maker, type, debug) 
                    })
                })

                Connector.addWebSocket('luno-myr', 'wss://ws.luno.com/api/1/stream/XRPMYR', ['MYR'], subscribe)
                Connector.listenHeartBeat('luno-myr')
                Connector.setHeartBeat('luno-myr', JSON.stringify({}), 10000)
                Connector.on('luno-myr', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.trade_updates == null) { return }
                    if (data.trade_updates.length <= 0) { return }
                    
                    data.trade_updates.forEach(function (trade, index) {
                        const maker = false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                        Rosetta.publish('luno', 'MYR', trade.base, trade.counter / trade.base, maker, type, debug) 
                    })
                })

                subscribe = [
                    { 'topic': 'trades:XRPAUD', 'event': 'phx_join', 'payload': {}, 'ref': 0 }, 
                    { 'topic': 'trades:XRPGBP', 'event': 'phx_join', 'payload': {}, 'ref': 0 },
                    { 'topic': 'trades:XRPUSDT', 'event': 'phx_join', 'payload': {}, 'ref': 0 },
                    { 'topic': 'trades:XRPUSDC', 'event': 'phx_join', 'payload': {}, 'ref': 0 },
                    { 'topic': 'trades:XRPBTC', 'event': 'phx_join', 'payload': {}, 'ref': 0 }]
                Connector.addWebSocket('coinjar', 'wss://feed.exchange.coinjar.com/socket/websocket', ['AUD', 'GBP', 'USDT', 'USDC', 'BTC'], subscribe)
                Connector.listenHeartBeat('coinjar')
                Connector.setHeartBeat('coinjar', JSON.stringify({ 'topic': 'phoenix', 'event': 'heartbeat', 'payload': {}, 'ref': 0 }), 10000)
                Connector.on('coinjar', (message) => {
                    const data = JSON.parse(message.data)
                    if (('status' in data.payload)) { return }
                    if (!('trades' in data.payload)) { return }
                    if ((data.event == 'init')) { return }
                    data.payload.trades.forEach(function (trade, index) {
                        // log('trade', trade)
                        const maker = (trade.side == 'sell') ? true:false
                        Rosetta.publish('coinjar', data.topic.substring('trades:XRP'.length), trade.size, trade.price, maker, type, debug) 
                    })
                })

                subscribe = [{ 'type' : 'transaction', 'symbols' : ['XRP_KRW', 'XRP_BTC'] }]
                Connector.addWebSocket('bithumb', 'wss://pubwss.bithumb.com/pub/ws', ['KRW', 'BTC'], subscribe)
                Connector.on('bithumb', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('content' in data)) { return }
                    data.content.list.forEach(function (trade, index) {
                        // log('trade', trade)
                        const maker = (trade.buySellGb == '1') ? true:false
                        Rosetta.publish('bithumb', trade.symbol.substring('XRP_'.length), trade.contQty, trade.contPrice, maker, type, debug) 
                    })
                })


                // InstrumentId 15 = XRP/USD
                // InstrumentId 20 = XRP/AUD
                // InstrumentId 23 = XRP/IDR
                // InstrumentId 28 = XRP/THB
                // InstrumentId 33 = XRP/SGD
                let osmid_zipmex = JSON.stringify({ OMSId: 1, InstrumentId: 15, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_zipmex}]
                Connector.addWebSocket('zipmex-usd', 'wss://apws.zipmex.com/WSGateway', ['USD'], subscribe)
                Connector.listenHeartBeat('zipmex-usd')
                Connector.setHeartBeat('zipmex-usd', JSON.stringify({'OMSId' :  1, 'ProductId' :  1}), 20000)
                Connector.on('zipmex-usd', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                        // log('trade-usd', trade)
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('zipmex', 'USD', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                osmid_zipmex = JSON.stringify({ OMSId: 1, InstrumentId: 20, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_zipmex}]
                Connector.addWebSocket('zipmex-aud', 'wss://apws.zipmex.com/WSGateway', ['AUD'], subscribe)
                Connector.on('zipmex-aud', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                        // log('trade-aud', trade)
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('zipmex', 'AUD', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                osmid_zipmex = JSON.stringify({ OMSId: 1, InstrumentId: 23, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_zipmex}]
                Connector.addWebSocket('zipmex-idr', 'wss://apws.zipmex.com/WSGateway', ['IDR'], subscribe)
                Connector.on('zipmex-idr', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                        // log('trade-idr', trade)
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('zipmex', 'IDR', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                osmid_zipmex = JSON.stringify({ OMSId: 1, InstrumentId: 28, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_zipmex}]
                Connector.addWebSocket('zipmex-thb', 'wss://apws.zipmex.com/WSGateway', ['THB'], subscribe)
                Connector.on('zipmex-thb', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                        // log('trade-thb', trade)
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('zipmex', 'THB', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                osmid_zipmex = JSON.stringify({ OMSId: 1, InstrumentId: 33, IncludeLastCount: 20 })
                subscribe = [{m: 0, i: 1, n: 'SubscribeTrades', o: osmid_zipmex}]
                Connector.addWebSocket('zipmex-sgd', 'wss://apws.zipmex.com/WSGateway', ['SGD'], subscribe)
                Connector.on('zipmex-sgd', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.n != 'TradeDataUpdateEvent') { return }
                    const trades = JSON.parse(data.o)
                    
                    trades.forEach(function (trade, index) {
                        // log('trade-sgd', trade)
                       const maker = (trade[8] == 1) ? true:false
                       Rosetta.publish('zipmex', 'SGD', parseFloat(trade[2]), trade[3], maker, type, debug)
                    })
                })

                subscribe = [{ 'action': 'sub', 'subscriptions': [{'channel': 'trade', 'market': 'xrptwd'}, {'channel': 'trade', 'market': 'xrpusdt'}], 'id': 'three' }]
                Connector.addWebSocket('max-exchange', 'wss://max-stream.maicoin.com/ws', ['TWD', 'USDT'], subscribe)
                Connector.listenHeartBeat('max-exchange')
                Connector.setHeartBeat('max-exchange', JSON.stringify({'op': 'ping'}), 30000)
                Connector.on('max-exchange', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.e != 'update') { return }
                    data.t.forEach((trade, i) => {
                        const maker = (trade.tr == 'up') ? true:false
                        Rosetta.publish('max-exchange', data.M.substring(3, data.M.length).toUpperCase(), trade.v, trade.p, maker, type, debug)
                    })
                })

                let bitoproSkip = true
                subscribe = [{ }]
                Connector.addWebSocket('bitopro', 'wss://stream.bitopro.com:9443/ws/v1/pub/trades/XRP_TWD', ['TWD'], subscribe)
                let lastTradeID = 0
                Connector.on('bitopro', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.event != 'TRADE') { return }
                    if (bitoproSkip != false) { 
                        bitoproSkip = false 
                        return 
                    }
                    data.data.forEach((trade, i) => {
                        if (trade.timestamp >= lastTradeID) {
                            const maker = (trade.isBuyer == 'true') ? true:false
                            Rosetta.publish('bitopro', data.pair.substring(4, data.pair.length), trade.amount, trade.price, maker, type, debug)
                            lastTradeID =trade.timestamp
                        }
                    })
                })

                subscribe = [{
                    'destination': 'trades.subscribe',
                    'payload': {'symbols': ['XRP/EUR', 'XRP/USD', 'XRP/BYN', 'XRP/BTC', 'XRP/USDT']} 
                }]
                Connector.addWebSocket('currency.com', 'wss://api-adapter.backend.currency.com/connect', ['EUR', 'USD', 'BYN', 'BTC', 'USDT'], subscribe)
                Connector.listenHeartBeat('currency.com')
                Connector.setHeartBeat('currency.com','PING', 3000)
                Connector.on('currency.com', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('destination' in data)) { return }
                    if (data.destination != 'internal.trade') { return }
                    
                    const maker = (data.payload.buyer == true) ? true:false
                    Rosetta.publish('currency.com', data.payload.symbol.substring('XRP/'.length).toUpperCase(), data.payload.size, data.payload.price, maker, type, debug)
                })

                
                const osmidPHP4 = JSON.stringify({ OMSId: 1 }) 
                subscribe = [{ 'method': 'SUBSCRIBE', 'params': ['xrpphp@trade'], 'id': 1 }]
                Connector.addWebSocket('coins.ph', 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3', ['PHP'], subscribe)
                Connector.listenHeartBeat('coins.ph')
                Connector.setHeartBeat('coins.ph', JSON.stringify({'ping': new Date().getTime()}), 10000)
                Connector.on('coins.ph', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('e' in data)) { return }
                    const maker = (data.m) ? true:false
                    Rosetta.publish('coins.ph', data.s.substring('XRP'.length), data.q, data.p, maker, type, debug)
                })

                subscribe = [{'type': 'subscribe','subscription': {'name': 'trade','id': 'BRLXRP'}}]
                Connector.addWebSocket('mercado-bitcoin', 'wss://ws.mercadobitcoin.net/ws', ['BRL'], subscribe)
                Connector.listenHeartBeat('mercado-bitcoin')
                Connector.setHeartBeat('mercado-bitcoin', 'PING', 10000)
                Connector.on('mercado-bitcoin', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('type' in data)) { return }
                    try {
                        const trade = data.data
                        const maker = (trade?.type == 'sell') ? true:false
                        Rosetta.publish('mercado-bitcoin', data.id.substring(0, 3).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                    } catch (e) {

                    }
                })

                subscribe = [{'event':'subscribe','streams':['xrpinr@trades', 'xrpusdt@trades', 'xrpbtc@trades']}]
                Connector.addWebSocket('wazirx', 'wss://stream.wazirx.com/stream', ['INR', 'USDT', 'BTC'], subscribe)
                Connector.listenHeartBeat('wazirx')
                Connector.setHeartBeat('wazirx', JSON.stringify({'event': 'ping'}), 50000)
                Connector.on('wazirx', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('data' in data)) { return }
                    if (!('trades' in data.data)) { return }
                    data.data.trades.forEach(function (trade, index) {
                        // log('trade', trade)
                        const maker = (trade.S == 'sell') ? true:false
                        Rosetta.publish('wazirx', trade.s.substring(3, trade.s.length).toUpperCase(), trade.q, trade.p, maker, type, debug) 
                    })
                })

                subscribe = [{
                    'event': 'subscribe',
                    'channel': ['trades'],
                    'symbols': ['XRP_USDT', 'XRP_USDC', 'XRP_USDD', 'XRP_BTC']
                }]
                Connector.addWebSocket('poloniex', 'wss://ws.poloniex.com/ws/public', ['USDT', 'USDC', 'USDD', 'BTC'], subscribe)
                Connector.listenHeartBeat('poloniex')
                Connector.setHeartBeat('poloniex',JSON.stringify({'event': 'ping'}), 3000)
                Connector.on('poloniex', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('channel' in data)) { return }
                    if (data.channel != 'trades') { return }
                    if ('event' in data) { return }
                    
                    data.data.forEach((trade, i) => {
                        const maker = (trade.takerSide == 'sell') ? true:false
                        Rosetta.publish('poloniex', trade.symbol.substring('XRP_'.length).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                    })
                })

                subscribe = [[{ 
                    'type': 'subHq', 
                    'event': 'trade',
                    'param': {
                        'businessType': 'coin-usdt-xrp',
                        'size': 20
                    }
                },{ 
                    'type': 'subHq', 
                    'event': 'trade',
                    'param': {
                        'businessType': 'coin-usdc-xrp',
                        'size': 20
                    }
                },{ 
                    'type': 'subHq', 
                    'event': 'trade',
                    'param': {
                        'businessType': 'coin-btc-xrp',
                        'size': 20
                    }
                }]]
                Connector.addWebSocket('bitforex', 'wss://www.bitforex.com/mkapi/coinGroup1/ws', ['USDT', 'USDC', 'BTC'], subscribe)
                Connector.listenHeartBeat('bitforex')
                Connector.setHeartBeat('bitforex', 'ping_p', 20000)
                Connector.on('bitforex', (message) => {
                    if (message.data == 'pong_p') { return }
                    const data = JSON.parse(message.data)
                    if ('size' in data.param) { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.direction == 1) ? true:false
                        Rosetta.publish('bitforex', data.param.businessType.split('-')[1].toUpperCase(), trade.amount, trade.price, maker, type, debug)
                    })
                })

                subscribe = [{'sub':'market.xrp_usdt.trade.detail'}, {'sub':'market.xrp_usdc.trade.detail'}, {'sub':'market.xrp_busd.trade.detail'}, {'sub':'market.xrp_btc.trade.detail'}]
                Connector.addWebSocket('hotcoin', 'wss://wss.hotcoinfin.com/trade/multiple', ['USDT', 'USDC', 'BUSD', 'BTC'], subscribe)

                Connector.listenHeartBeat('hotcoin')
                Connector.setHeartBeat('hotcoin', JSON.stringify({'pong': 'pong'}), 2500)
                Connector.on('hotcoin', (message) => {
                    let pakodata = new Uint8Array(message.data)
                    const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                    
                    // if ('ping' in data) {
                    //     // respond to ping
                    //     log(data)
                    //     // Connector.setHeartBeat('hotcoin', JSON.stringify({'pong': 'pong'}), false)
                    // }
                    // log(data)
                    if (!('data' in data)) { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.direction == 'sell') ? true:false
                        const ch = data.ch.split('.')
                        const token = ch[1].substring('xrp_'.length).toUpperCase()
                        Rosetta.publish('hotcoin-global', token, trade.amount, trade.price, maker, type, debug)
                    })
                })
                
                subscribe = [{
                    'op':'subscribe',
                    'args': [
                        {
                            'channel': 'trades',
                            'instId': 'XRP-USDC'
                        },
                        {
                            'channel': 'trades',
                            'instId': 'XRP-USDT'
                        },
                        {
                            'channel': 'trades',
                            'instId': 'XRP-BTC'
                        },
                        {
                            'channel': 'trades',
                            'instId': 'XRP-ETH'
                        }
                    ]
                }]
                
                Connector.addWebSocket('okx', 'wss://ws.okx.com:8443/ws/v5/public', ['USDT', 'USDC', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('okx')
                Connector.setHeartBeat('okx', 'PING', 20000)
                Connector.on('okx', (message) => {
                    const data = JSON.parse(message.data)
                    if (!Array.isArray(data.data)) { return }
                    if (!('arg' in data)) { return }
                    if (!('channel' in data.arg)) { return }
                    if (data.arg.channel != 'trades') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade.side == 'sell') ? true:false
                        Rosetta.publish('okx', trade.instId.substring(4), trade.sz, trade.px, maker, type, debug)
                    })
                })


                subscribe = [{ 'command': 'subscribe', 'channel': 'trades', 'symbol': 'XRP_JPY'}]
                Connector.addWebSocket('bitbank', 'wss://api.coin.z.com/ws/public/v1', ['JPY'], subscribe)
                Connector.on('bitbank', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.channel != 'trades') { return }
                    //console.log(data)
                    const maker = (data.side == 'SELL') ? true:false
                    Rosetta.publish('bitbank', data.symbol.substring('XRP_'.length), data.size, data.price, maker, type, debug)
                })

                //data reported seems to be a carbon copy of hitbtc WTH!!!!
                // subscribe = [{ 'method': 'subscribe', 'ch': 'trades', 'params': { 'symbols': ['XRPUSDT'], 'limit': 0 }, 'id': id }]
                // Connector.addWebSocket('fmfw', 'wss://api.fmfw.io/api/3/ws/public', ['USDT'], subscribe)
                // Connector.listenHeartBeat('fmfw')
                // Connector.setHeartBeat('fmfw', 'PING', 20000)
                // Connector.on('fmfw', (message) => {
                //     const data = JSON.parse(message.data)
                    
                //     if (!('update' in data)) { return }
                //     if (!('ch' in data)) { return }
                //     if (data.ch != 'trades') { return }
                //     // log(data.update)
                //     data.update.XRPUSDT.forEach((trade, i) => {
                //         const maker = (trade.s == 'sell') ? true:false
                //         Rosetta.publish('fmfw', 'USDT', trade.q, trade.p, maker, type, debug)
                //     })
                // })

                subscribe = [{ 'method': 'subscribe', 'ch': 'trades', 'params': { 'symbols': ['XRPUSDT'], 'limit': 0 }, 'id': id }]
                Connector.addWebSocket('hitbtc', 'wss://api.hitbtc.com/api/3/ws/public', ['USDT'], subscribe)
                Connector.listenHeartBeat('hitbtc')
                Connector.setHeartBeat('hitbtc', 'PING', 20000)
                Connector.on('hitbtc', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('update' in data)) { return }
                    if (!('ch' in data)) { return }
                    if (data.ch != 'trades') { return }
                    data.update.XRPUSDT.forEach((trade, i) => {
                        const maker = (trade.s == 'sell') ? true:false
                        Rosetta.publish('hitbtc', 'USDT', trade.q, trade.p, maker, type, debug)
                    })
                })

                let bitmartSkip = true
                subscribe = [{'op': 'subscribe', 'args': ['spot/trade:XRP_USDT']}]
                Connector.addWebSocket('bitmart', 'wss://ws-manager-compress.bitmart.com/api?protocol=1.1', ['USDT'], subscribe)
                Connector.listenHeartBeat('bitmart')
                Connector.setHeartBeat('bitmart', 'ping', 10000)
                Connector.on('bitmart', (message) => {
                    if (message.data == 'pong') { return }
                    if (bitmartSkip) {
                        bitmartSkip = false
                        return 
                    }
                    try {
                        const data = JSON.parse(message.data)
                        // log(data)
                        const trades = data.data
                        
                        trades.forEach(function (trade, index) {
                            // console.log('trade', trade)
                            const maker = (trade.takerSide == 'sell') ? true:false
                            Rosetta.publish('bitmart', trade.symbol.substring('XRP_'.length), trade.size, trade.price, maker, type, debug) 
                        })
                    }catch (e) {
                        return
                    }
                    
                    
                })
                
                subscribe = [{ 'method': 'SUBSCRIPTION', 'params':['spot@public.deals.v3.api@XRPUSDT', 'spot@public.deals.v3.api@XRPUSDC', 'spot@public.deals.v3.api@XRPBTC', 'spot@public.deals.v3.api@XRPETH'] }]
                Connector.addWebSocket('mxc', 'wss://wbs.mexc.com/ws', ['USDT', 'USDC', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('mxc')
                Connector.setHeartBeat('mxc', JSON.stringify({'method':'PING'}),5000)
                Connector.on('mxc', (message) => {
                    const data = JSON.parse(message.data)
                    if (data.msg == 'PONG') { return }
                    if (!('d' in data)) { 
                        // log(data)
                        return }
                    // log(data)
                    data.d.deals.forEach((trade, i) => {
                        const maker = (trade.direction == 1) ? true:false
                        Rosetta.publish('mxc', data.s.substring('XRP'.length), trade.v *1, trade.p*1, maker, type, debug)
                    })
                })


                subscribe = [{
                    'method': 'SUBSCRIBE',
                    'params': [
                      'xrpusdt@aggTrade',
                      'xrpbusd@aggTrade',
                      'xrptusd@aggTrade',
                      'xrpbidr@aggTrade',
                      'xrpbtc@aggTrade',
                      'xrpeth@aggTrade',
                      'xrpbnb@aggTrade',
                      'xrpfdusd@aggTrade',
                    ],
                    'id': id
                  }]      
                Connector.addWebSocket('tokocrypto', 'wss://stream-cloud.binanceru.net/ws', ['USDT', 'BUSD', 'TUSD', 'BIDR', 'BTC', 'ETH', 'BNB', 'FDUSD'], subscribe)
                Connector.on('tokocrypto', (message) => {
                    if (message.data.includes('ping')) { 
                        return }

                    if (!message.data.includes('aggTrade')) { return }
                    const data = JSON.parse(message.data)
                    Rosetta.publish('tokocrypto', data.s.substring('XRP'.length), data.q, data.p, data.m, type, debug)
                })

                subscribe = [{ 'method': 'subscribe', 'params': ['trade@xrp_usdt', 'trade@xrp_usdc', 'trade@xrp_busd', 'trade@xrp_btc', 'trade@xrp_eth'], 'id': id}]     
                Connector.addWebSocket('xt', 'wss://stream.xt.com/public', ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('xt')
                Connector.setHeartBeat('xt', JSON.stringify({'ping': ''}), 20000)
                Connector.on('xt', (message) => {
                    if (!message.data.includes('trade')) { return }
                    const data = JSON.parse(message.data)
                    Rosetta.publish('xt', data.data.s.substring('xrp_'.length).toUpperCase(), data.data.q, data.data.p, type, data.data.b, debug)
                })


                 //data reported seems to be a carbon copy of hitbtc WTH!!!!
                // subscribe = [{
                //     'method': 'subscribe',
                //     'ch': 'trades',
                //     'params': {
                //         'symbols': ['XRPEURS'],
                //         'limit': 0
                //     },
                //     'id': id
                // }]
                // Connector.addWebSocket('cryptomkt', 'wss://api.exchange.cryptomkt.com/api/3/ws/public', ['XRPEURS'], subscribe)
                // Connector.on('cryptomkt', (message) => {
                //     const data = JSON.parse(message.data)
                //     if (!('update' in data)) { return }
                //     if (!('ch' in data)) { return }
                //     if (data.ch != 'trades') { return }
                //     // data copy of hitbtc ignored
                //     // if ('XRPUSDT' in data.update) {
                //     //     data.update.XRPUSDT.forEach((trade, i) => {
                //     //         const maker = (trade.s == 'sell') ? true:false
                //     //         Rosetta.publish('cryptomkt', 'USDT', trade.q, trade.p, maker, type, debug)
                //     //     })
                //     // }
                //     if ('XRPEURS' in data.update) {
                //         data.update.XRPEURS.forEach((trade, i) => {
                //             const maker = (trade.s == 'sell') ? true:false
                //             Rosetta.publish('cryptomkt', 'EURS', trade.q, trade.p, maker, type, debug)
                //         })
                //     }
                // })

                const osmid_flowbtc1 = JSON.stringify({ OMSId: 1, InstrumentId: 7, IncludeLastCount: 23 }) // XRPBRL
                subscribe = [
                    {m: 0, i: 0, n: 'GetInstruments',  o: osmidPHP4 },
                    {m: 0, i: 1, n: 'SubscribeTrades', o: osmid_flowbtc1}]
                Connector.addWebSocket('flowbtc', 'wss://api.flowbtc.com.br/WSGateway/', ['BRL'], subscribe)
                // Connector.listenHeartBeat('flowbtc')
                // Connector.setHeartBeat('flowbtc', 'PING', 10000)
                Connector.on('flowbtc', (message) => {
                    const data = JSON.parse(message.data)
                    // console.log(data.o)
                    if (!('type' in data)) { return }
                    const trade = data.data
                    const maker = (trade.type == 'sell') ? true:false
                    Rosetta.publish('flowbtc', data.id.substring(0, 3).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                })

                subscribe = [{'event':'sub','topic':'xrp_usdt.trade, xrp_usdc.trade'}]
                Connector.addWebSocket('bkex', 'wss://fapi.bkex.com/fapi/v2/ws', ['USDT', 'USDC'], subscribe)
                Connector.on('bkex', (message) => {
                    const data = JSON.parse(message.data)
                    
                    // dont spot ping...
                    // Connector.setHeartBeat('bkex', JSON.stringify({'pong': 'pong'}), false)
                    if (!data.type.includes('trade')) { 
                        // log('data', data)
                        return }
                    const maker = (data.data[1] == 1) ? true:false
                    Rosetta.publish('bkex', data.type.split('.')[0].substring('xrp_'.length).toUpperCase(), data.data[2]*1, data.data[0]*1, maker, type, debug)
                    
                })

                subscribe = [{ 'id': 9, 'method': 'trades_subscribe', 'params': [ 'XRP_EUR', 'XRP_TRY', 'XRP_USD', 'XRP_USDT', 'XRP_USDC', 'XRP_BTC'] }]
                Connector.addWebSocket('whitebit', 'wss://api.whitebit.com/ws', ['EUR', 'TRY', 'USD', 'USDT', 'USDC', 'BTC'], subscribe)
                Connector.listenHeartBeat('whitebit')
                Connector.setHeartBeat('whitebit', JSON.stringify({'id': 0, 'method': 'ping', 'params': []}), 10000)
                Connector.on('whitebit', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('method' in data)) { return }
                    if ('trades_update' != data.method) { return }
                    if (!('params' in data)) { return }
                    if (data.params.length <= 0) { return }
                    data.params[1].forEach(function (trade, index) {
                        const maker = (trade.type == 'sell') ? true:false
                        Rosetta.publish('whitebit', data.params[0].substring('XRP_'.length), trade.amount, trade.price, maker, type, debug) 
                    })
                })
                
                subscribe = [{'method': 'SUBSCRIBE', 'params': [{type: 'trade', symbol:'XRPTRY'}]}, {'method': 'SUBSCRIBE', 'params': [{type: 'trade', symbol:'XRPUSDT'}]}]
                Connector.addWebSocket('narkasa', 'wss://api.narkasa.com/v3', ['TRY', 'USDT'], subscribe)
                Connector.on('narkasa', (message) => {
                    const data = JSON.parse(message.data)
                    if ('status' in data && data.status == 'success') { return }
                    if (data.type != 'trade') { return }
                    const maker = (data.tradeType == 'sell') ? true:false
                    Rosetta.publish('narkasa', data.symbol.substring('XRP'.length), data.amount, data.price, maker, type, debug) 
                })

                subscribe = [{'method':'deals.subscribe','params':['XRP_USDT'], 'id':id}]
                Connector.addWebSocket('biconomy', 'wss://www.biconomy.com/ws', ['USDT'], subscribe)
                Connector.listenHeartBeat('biconomy')
                Connector.on('biconomy', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        if (('method' in data) && data.method === 'server.ping') {
                            Connector.setHeartBeat('biconomy', JSON.stringify({'error': null, 'result': 'pong', 'id': id}), false)
                        }
                        if (!('method' in data) && data.method !== 'deals.update') { return }
                        if (!Array.isArray(data.params)) { return }
                        Array.from(data.params[1]).forEach(function (trade, index) {
                            const maker = (trade.type == 'sell') ? true:false
                            Rosetta.publish('biconomy', data.params[0].substring('XRP_'.length), trade.amount, trade.price, maker, type, debug)
                        })
                    } catch (e) {
                        log('biconomy error', e)
                    }
                })
                
                
                subscribe = [{
                    "e": "subscribe",
                    "rooms": [
                       "pair-XRP-USD",
                    ]
                }]
                Connector.addWebSocket('cexio-usd', 'wss://ws.cex.io/ws/', ['USD'], subscribe)
                Connector.on('cexio-usd', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('e' in data)) { return }
                    if (data.e == 'ping') {
                        Connector.send('cexio-usd', JSON.stringify({ 'e': 'pong'}))
                    }
                    if (data.e != 'history-update') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade[0] == 'sell') ? true:false
                        Rosetta.publish('cex.io', 'USD', trade[2]/1_000_000, trade[3], maker, type, debug)
                    })
                })

                subscribe = [{
                    "e": "subscribe",
                    "rooms": [
                       "pair-XRP-USDT",
                    ]
                }]
                Connector.addWebSocket('cexio-usdt', 'wss://ws.cex.io/ws/', ['USDT'], subscribe)
                Connector.on('cexio-usdt', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('e' in data)) { return }
                    if (data.e == 'ping') {
                        Connector.send('cexio-usdt', JSON.stringify({ 'e': 'pong'}))
                    }
                    if (data.e != 'history-update') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade[0] == 'sell') ? true:false
                        Rosetta.publish('cex.io', 'USDT', trade[2]/1_000_000, trade[3], maker, type, debug)
                    })
                })

                subscribe = [{
                    "e": "subscribe",
                    "rooms": [
                       "pair-XRP-EUR",
                    ]
                }]
                Connector.addWebSocket('cexio-eur', 'wss://ws.cex.io/ws/', ['EUR'], subscribe)
                Connector.on('cexio-eur', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('e' in data)) { return }
                    if (data.e == 'ping') {
                        Connector.send('cexio-eur', JSON.stringify({ 'e': 'pong'}))
                    }
                    if (data.e != 'history-update') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade[0] == 'sell') ? true:false
                        Rosetta.publish('cex.io', 'EUR', trade[2]/1_000_000, trade[3], maker, type, debug)
                    })
                })

                subscribe = [{
                    "e": "subscribe",
                    "rooms": [
                       "pair-XRP-GBP",
                    ]
                }]
                Connector.addWebSocket('cexio-gbp', 'wss://ws.cex.io/ws/', ['GBP'], subscribe)
                Connector.on('cexio-gbp', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('e' in data)) { return }
                    if (data.e == 'ping') {
                        Connector.send('cexio-gbp', JSON.stringify({ 'e': 'pong'}))
                    }
                    if (data.e != 'history-update') { return }
                    data.data.forEach((trade, i) => {
                        const maker = (trade[0] == 'sell') ? true:false
                        Rosetta.publish('cex.io', 'GBP', trade[2]/1_000_000, trade[3], maker, type, debug)
                    })
                })


                Connector.addWebSocket('satang-pro', 'wss://ws.satangcorp.com/ws/xrp_thb@aggTrade', ['THB'], [])
                Connector.on('satang-pro', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        if (!('e' in data) || data.e != 'aggTrade') { return }
                        const maker = (data.m == true) ? true:false
                        Rosetta.publish('satang-pro', data.s.substring('xrp_'.length).toUpperCase(), data.q*1, data.p*1, maker, type, debug)
                    }   catch (e) {
                        log('satang-pro THB error', e)
                    }
                })

                subscribe = [{'m': 'subscribe.trades'}]
                Connector.addWebSocket('nicehashUSDT', 'wss://xrpusdt.ws.nicex.com', ['USDT'], subscribe)
                let nicehashUSDT = false
                Connector.on('nicehashUSDT', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        // log(data)
                        data.t.forEach((trade, i) => {
                            const maker = (trade.d == 'SELL') ? true:false
                            if(nicehashUSDT) {
                                Rosetta.publish('nicehash', 'USDT', trade.q, trade.p, maker, type, debug)
                            }
                        })
                        nicehashUSDT = true
                    }   catch (e) {
                        log('nicehashUSDT error', e)
                    }
                })

                subscribe = [{'m': 'subscribe.trades'}]
                Connector.addWebSocket('nicehashBTC', 'wss://xrpbtc.ws.nicex.com', ['BTC'], subscribe)
                let nicehashBTC = false
                Connector.on('nicehashBTC', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        data.t.forEach((trade, i) => {
                            const maker = (trade.d == 'SELL') ? true:false
                            if(nicehashBTC) {
                                Rosetta.publish('nicehash', 'BTC', trade.q, trade.p, maker, type, debug)
                            }
                        })
                        nicehashBTC = true
                    }   catch (e) {
                        log('nicehashBTC error', e)
                    }
                })

                // subscribe = [{'m': 'subscribe.trades'}]
                // Connector.addWebSocket('nicehashUSDC', 'wss://xrpusdc.ws.nicex.com', ['USDC'], subscribe)
                // let nicehashUSDC = false
                // Connector.on('nicehashUSDC', (message) => {
                //     const data = JSON.parse(message.data)
                //     // log(data)
                //     data.t.forEach((trade, i) => {
                //         const maker = (trade.d == 'SELL') ? true:false
                //         if(nicehashUSDC) {
                //             Rosetta.publish('nicehash', 'USDC', trade.q, trade.p, maker, type, debug)
                //         }
                //     })
                //     nicehashUSDC = true
                // })
            
                subscribe = [{ type: 'SUBSCRIBE', requestId: 'threexrp-AUDT', pattern: '/trade.symbols/XRP/AUDT' }, { type: 'SUBSCRIBE', requestId: 'threexrp-USDT', pattern: '/trade.symbols/XRP/USDT' }]
                Connector.addWebSocket('timex', 'wss://plasma-relay-backend.timex.io/socket/relay', ['AUDT', 'USDT'], subscribe)
                Connector.on('timex', (message) => {
                    const data = JSON.parse(message.data)
                    if (!('message' in data)) { return }
                   
                    const maker = data.message.payload.direction == 'SELL' ? true:false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                    Rosetta.publish('timex', data.message.event.data.quoteTokenSymbol, data.message.payload.quantity, data.message.payload.price, maker, type, debug) 
                })

                subscribe = [{ 'action':'subscribe', 'subscribe':'trade' }, { 'action':'subscribe', 'subscribe':'trade', 'pair':'xrp_usdt' }, { 'action':'subscribe', 'subscribe':'trade', 'pair':'xrp_usdc' }, { 'action':'subscribe', 'subscribe':'trade', 'pair':'xrp_btc' }]
                Connector.addWebSocket('lbank', 'wss://www.lbkex.net/ws/V2/', ['USDT', 'USDC', 'BTC'], subscribe)
                Connector.on('lbank', (message) => {
                    try {
                        const data = JSON.parse(message.data)
                        // log(data)
                        if ('ping' in data) {
                            // respond to ping
                            Connector.setHeartBeat('lbank', JSON.stringify({'pong': data.ping}), false)
                            return
                        }
                        if (!('trade' in data)) {
                            //log(data)
                            return
                        }
                        const maker = (data.trade.direction == 'sell') ? true:false
                        Rosetta.publish('lbank', data.pair.substring('xrp_'.length).toUpperCase(), data.trade.amount, data.trade.price, maker, type, debug)
                    } catch (error) {
                        log(error)
                    }
                })

                // COPY HITBTC
                // subscribe = [{
                //     'method': 'subscribe',
                //     'ch': 'trades',
                //     'params': {
                //         'symbols': ['XRPEURS'],
                //         'limit': 0
                //     },
                //     'id': id
                // }]
                // Connector.addWebSocket('cryptomkt', 'wss://api.exchange.cryptomkt.com/api/3/ws/public', ['XRPEURS'], subscribe)
                // Connector.on('cryptomkt', (message) => {
                //     const data = JSON.parse(message.data)
                //     if (!('update' in data)) { return }
                //     if (!('ch' in data)) { return }
                //     if (data.ch != 'trades') { return }
                //     // COPY OF HITBTC
                //     // if ('XRPUSDT' in data.update) {
                //     //     data.update.XRPUSDT.forEach((trade, i) => {
                //     //         const maker = (trade.s == 'sell') ? true:false
                //     //         Rosetta.publish('cryptomkt', 'USDT', trade.q, trade.p, maker, type, debug)
                //     //     })
                //     // }
                //     if ('XRPEURS' in data.update) {
                //         data.update.XRPEURS.forEach((trade, i) => {
                //             const maker = (trade.s == 'sell') ? true:false
                //             Rosetta.publish('cryptomkt', 'EURS', trade.q, trade.p, maker, type, debug)
                //         })
                //     }
                // })
                // INVALID DATA hundereds of millions XRP flow yet nothing moving on ledger
                // call bullshit!
                // subscribe = [{
                //     'event':'addChannel',
                //     'channel':'xrpusdt_trades',
                // },{
                //     'event':'addChannel',
                //     'channel':'xrpusdc_trades',
                // }]
                // Connector.addWebSocket('zb', 'wss://api.zb.com/websocket', ['USDT', 'USDC'], subscribe)
                // Connector.listenHeartBeat('zb')
                // Connector.setHeartBeat('zb', 'PING', 20000)
                // Connector.on('zb', (message) => {
                //     const data = JSON.parse(message.data)
                //     data.data.forEach((trade, i) => {
                //         const maker = (trade.type == 'sell') ? true:false
                //         Rosetta.publish('zb', data.channel.split('_')[0].substring(3).toUpperCase(), trade.amount, trade.price, maker, type, debug)
                //     })
                // })


                // try {
                //     subscribe = [{
                //         'type': 'subscribe',
                //         'channel': 'xrp_jpy-trades'
                //     }]
                //     Connector.addWebSocket('coincheck', 'wss://ws-api.coincheck.com', ['JPY'], subscribe)
                //     Connector.listenHeartBeat('coincheck')
                //     Connector.setHeartBeat('coincheck', JSON.stringify({'op': 'ping'}), 10000)
                //     Connector.on('coincheck', (message) => {
                //         const data = JSON.parse(message.data)
                //         console.log('data', data)
                //         if (data == null) { return }
                //         if (!(Array.isArray(data))) { return }

                //         data.forEach((trade, i) => {
                //             const maker = (trade[4] == 'buy') ? true:false
                //             Rosetta.publish('coincheck', data[1].substring('xrp_'.length).toUpperCase(), data[3], data[2], maker, type, debug)
                //         })
                //     })
                // } catch (e) {
                //     // this ones dodgy
                // }


                subscribe = [{'type': 'subscribe','subscriptions':[{'name':'l2','symbols':['XRPUSD']}]}]
                Connector.addWebSocket('gemini', 'wss://api.gemini.com/v2/marketdata', ['USD'], subscribe)
                // Connector.listenHeartBeat('gemini')
                // Connector.setHeartBeat('okx', 'PING', 20000)
                Connector.on('gemini', (message) => {
                    const data = JSON.parse(message.data)
                    
                    if ('type' in data && data.type == 'l2_updates') { return }
                    if ('type' in data && data.type === 'trade') {
                        const maker = (data.side == 'sell') ? true:false
                        Rosetta.publish('gemini', data.symbol.substring(3), data.quantity, data.price, maker, type, debug)
                    }
                })
            },
            async oneOffs() {
                const debug = false
                const type = 'socket'
                const client = new Kucoin()
                const symbols = ['XRP-USDT', 'XRP-USDC', 'XRP-BTC', 'XRP-ETH']
                Connector.addNonStandard('Kucoin', ['USDC', 'USDT', 'BTC', 'ETH'])
                Connector.publishResult('Kucoin', null, false)

                await client.MarketMatches(symbols, (trade) => {
                    const maker = (trade.side == 'sell') ? true:false
                    Rosetta.publish('kucoin', trade.symbol.substring('XRP-'.length), trade.size, trade.price, maker, type, debug)
                })

                const bitflyer = io('https://io.lightstream.bitflyer.com', {
                    transports: ['websocket']
                })
                
                Connector.addNonStandard('bitflyer', ['JPY'])
                Connector.publishResult('bitflyer', null, false)

                bitflyer.emit('subscribe', 'lightning_executions_XRP_JPY')
                bitflyer.on('lightning_executions_XRP_JPY', (trades) => {
                    trades.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        Rosetta.publish('bitflyer', 'JPY', trade.size, trade.price, maker, type, debug) 
                    })            
                })


                const socket_novadax = io("wss://api.novadax.com", {
                    transports: ['websocket']
                })
                Connector.addNonStandard('novadax', ['BRL', 'USDT', 'BTC'])
                Connector.publishResult('novadax', null, false)
                socket_novadax.emit('SUBSCRIBE', ['MARKET.XRP_BRL.TRADE', 'MARKET.XRP_USDT.TRADE', 'MARKET.XRP_BTC.TRADE'])
                socket_novadax.on('MARKET.XRP_BRL.TRADE', (trades) => {
                    trades.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        Rosetta.publish('novadax', 'BRL', trade.amount, trade.price, maker, type, debug)
                    })
                })
                socket_novadax.on('MARKET.XRP_USDT.TRADE', (trades) => {
                    trades.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        Rosetta.publish('novadax', 'USDT', trade.amount, trade.price, maker, type, debug)
                    })
                })
                socket_novadax.on('MARKET.XRP_BTC.TRADE', (trades) => {
                    trades.forEach((trade, i) => {
                        const maker = (trade.side == 'SELL') ? true:false
                        Rosetta.publish('novadax', 'BTC', trade.amount, trade.price, maker, type, debug)
                    })
                })
                

                const Pusher = require('pusher-js')
                const pusher = new Pusher('ce386deb63691b2f671c', {
                    cluster: 'us2',
                    forceTLS: true
                })
                const channel1 = pusher.subscribe('prod-XRPCLP-trades')
                Connector.addNonStandard('orionx', ['CLP', 'MXN', 'BTC'])
                Connector.publishResult('orionx', null, false)
                channel1.bind('new-trade', function (trade) {
                    // console.log(trade)
                    const maker = true // not provided....?
                    Rosetta.publish('orionx', 'CLP', (trade.amount / 1000000), trade.price, maker, type, debug)
                    Connector.publishResult('orionx', null, false)
                })

                const channel2 = pusher.subscribe('prod-XRPMXN-trades')
                channel2.bind('new-trade', function (trade) {
                    // console.log(trade)
                    const maker = true // not provided....?
                    Rosetta.publish('orionx', 'MXN', (trade.amount / 1000000), trade.price, maker, type, debug)
                    Connector.publishResult('orionx', null, false)
                })

                const channel3 = pusher.subscribe('prod-XRPBTC-trades')
                channel3.bind('new-trade', function (trade) {
                    // console.log(trade)
                    const maker = true // not provided....?
                    Rosetta.publish('orionx', 'BTC', (trade.amount / 1000000), trade.price, maker, type, debug)
                    Connector.publishResult('orionx', null, false)
                })

                const coindcx = io('wss://stream.coindcx.com', {
                    transports: ['websocket']
                })
                Connector.addNonStandard('coindcx', ['USDT', 'BUSD', 'INR', 'BNB'])
                Connector.publishResult('coindcx', null, false)
                coindcx.emit('join', { 'channelName': 'B-XRP_USDT' })
                coindcx.emit('join', { 'channelName': 'B-XRP_BUSD' })
                coindcx.emit('join', { 'channelName': 'B-XRP_INR' })
                coindcx.emit('join', { 'channelName': 'B-XRP_BNB' })
                coindcx.emit('join', { 'channelName': 'B-XRP_ETH' })
                coindcx.emit('join', { 'channelName': 'B-XRP_BTC' })
                coindcx.on('new-trade', (message) => {
                    const trade = JSON.parse(message.data)
                    const maker = (trade.M == true) ? true:false
                    Rosetta.publish('coindcx', trade.channel.substring('B-XRP_'.length), trade.q, trade.p, maker, type, debug) 
                })

                const Coinfield = require('node-coinfield-api').Coinfield
                const coinfield = new Coinfield('', true)
                coinfield.socket.subscribe.market('xrpaed')
                coinfield.socket.subscribe.market('xrpcad')
                coinfield.socket.subscribe.market('xrpusd')
                coinfield.socket.subscribe.market('xrpgbp')
                coinfield.socket.subscribe.market('xrpeur')
                coinfield.socket.subscribe.market('xrpjpy')
                coinfield.socket.subscribe.market('xrpusdt')
                coinfield.socket.subscribe.market('xrpusdc')
                coinfield.socket.subscribe.market('xrpbtc')
                Connector.addNonStandard('coinfield', ['AED', 'CAD', 'USD', 'GBP', 'EUR', 'JPY', 'USDT', 'USDC', 'BTC'])
                Connector.publishResult('coinfield', null, false)

                coinfield.socket.listener.on('trades_updates__xrpbtc',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'BTC', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpaed',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'AED', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpcad',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'CAD', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpusd',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'USD', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpgbp',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'GBP', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpeur',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'EUR', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpjpy',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'JPY', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpusdt',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'USDT', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                coinfield.socket.listener.on('trades_updates__xrpusdc',(trades)=> {
                    trades.data.forEach((trade, i) => {
                        const maker = (trade.direction == -1) ? true:false
                        Rosetta.publish('coinfield', 'USDC', trade.volume, trade.price, maker, type, debug)
                    })
                    Connector.publishResult('coinfield', null, false)
                })

                Connector.addNonStandard('emirex', ['USDT'])
                Connector.publishResult('emirex', null, false)
                const socket_emirex = io.connect('https://socket.emirex.com');
                socket_emirex.on('connect', function () {
                    socket_emirex.emit('subscribe', {type: 'hist', event: 'hist_181'});

                })
                socket_emirex.on('message', function (ms) {
                    ms.forEach((trade, i) => {
                        if (trade.type === 'hist') { 
                            const maker = (trade.type == 0) ? true:false
                            Rosetta.publish('emirex', 'USDT', trade.data.volume / 1_000_000_00, trade.data.rate / 1_000_000_00, maker, type, debug)     
                        }                        
                    })
                })
            },
			bitbankArgZone() {
                let d = new Date().toLocaleString('en-US')
                d = d.toString().split(',')
                d = d[0].toString().split('/')
                // console.log(d)
                let dd = (d[0] < 10) ? '0'+d[0] : d[0]
                let dm = (d[1] < 10) ? '0'+d[1] : d[1]
                //console.log('composed: ' +  d[2] + dm + dd)
                return d[2] + dd + dm
            },
            pollRest() {
                let subscribe = []
                const debug = false
                const type = 'rest'
                try {
                    subscribe = [{'url':'https://api.coincola.com/v1/market/trade?market_pair=XRP_USDT&limit=100', 'fiat':'USDT', 'interval': 2000}]
                    Connector.addRestServer('coincola', subscribe)
                    Connector.pollServer('coincola')
                    Connector.on('coincola', (message) => {
                        
                        if (message.data != null && Array.isArray(message.data)) {
                            // log(message.data)
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                // console.log(trade)
                                if (trade.trade_id > Connector.getLastTradeID('coincola', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('coincola', message.fiat, trade.quote_volume, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('coincola', message.fiat,trade.trade_id)
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://exchange-api.xago.io/v1/tradehistory?currencyPair=XRP/ZAR', 'fiat':'ZAR', 'interval': 2000},
                        {'url':'https://exchange-api.xago.io/v1/tradehistory?currencyPair=XRP/EUR', 'fiat':'EUR', 'interval': 2000},
                        {'url':'https://exchange-api.xago.io/v1/tradehistory?currencyPair=XRP/USD', 'fiat':'USD', 'interval': 2000},
                        {'url':'https://exchange-api.xago.io/v1/tradehistory?currencyPair=XRP/GBP', 'fiat':'GBP', 'interval': 2000}]
                    Connector.addRestServer('xago', subscribe)
                    Connector.pollServer('xago')
                    Connector.on('xago', (message) => {
                        
                        if (message.data != null && Array.isArray(message.data)) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                // console.log(trade)
                                if (trade.time > Connector.getLastTradeID('xago', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.color == 'RED') ? true:false
                                        Rosetta.publish('xago', message.fiat, trade.size, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('xago', message.fiat,trade.time)
                                }
                            })
                        }
                    })

                    // subscribe = [{'url':'https://api.artisturba.com/api/trade_history/XRP_ZAR', 'fiat':'ZAR', 'interval': 2000}]
                    // Connector.addRestServer('artisturba', subscribe)
                    // Connector.pollServer('artisturba')
                    // Connector.on('artisturba', (message) => {
                    //     if (message.data != null && Array.isArray(message.data.trade_history)) {
                    //         let trades = message.data.trade_history.reverse()
                    //         trades.forEach((trade, i) => {
                    //             //console.log(trade)
                    //             if (Date.parse(trade.date) > Connector.getLastTradeID('artisturba', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.side == 'Sell') ? true:false
                    //                     Rosetta.publish('artisturba', message.fiat, trade.amount, trade.rate, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('artisturba', message.fiat, Date.parse(trade.date))
                    //             }
                    //         })
                    //     }
                    // })

                    // subscribe = [{'url':'https://naijacrypto.com/api/getmarkethistory?market=XRP-NGN', 'fiat':'NGN', 'interval': 1000}]
                    // Connector.addRestServer('naijacrypto', subscribe)
                    // Connector.pollServer('naijacrypto')
                    // Connector.on('naijacrypto', (message) => {
                    //     if (message.data != null && message.data.result != null && Array.isArray(message.data.result)) {
                    //         let trades = message.data.result.reverse()
                    //         //console.log(trades)
                    //         trades.forEach((trade, i) => {
                    //             if (trade.Id > Connector.getLastTradeID('naijacrypto', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.OrderType == 'Sell') ? true:false
                    //                     Rosetta.publish('naijacrypto', message.fiat, trade.Quantity, trade.Price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('naijacrypto', message.fiat, trade.Id)
                    //             }
                    //         })
                    //     }
                    // })
                    
                    // invalid data removing this exchange https://twitter.com/ShortTheFOMO/status/1617681027388014593?s=20&t=ktgVcPUb00ubhaFTvkSvRw
                    // subscribe = [{'url':'https://b2t-api-b2bx.flexprotect.org//marketdata/cmc/v1/trades/XRP_EUR', 'fiat':'EUR', 'interval': 6000},
                    //     {'url':'https://b2t-api-b2bx.flexprotect.org//marketdata/cmc/v1/trades/XRP_USD', 'fiat':'USD', 'interval': 6000}]
                    // Connector.addRestServer('b2bx', subscribe)
                    // Connector.pollServer('b2bx')
                    // Connector.on('b2bx', (message) => {
                    //     if (message.data != null) {
                    //         let trades = message.data

                    //         trades.forEach((trade, i) => {
                    //             if (trade.tradeID > Connector.getLastTradeID('b2bx', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.type == 'sell') ? true:false
                    //                     Rosetta.publish('b2bx', message.fiat, trade.quote_volume, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('b2bx', message.fiat, trade.tradeID)
                    //             }
                    //         })
                    //     }
                    // })
                    
                    // lots of 403
                    // subscribe = [{'url':'https://yobit.net/api/2/xrp_rur/trades', 'fiat':'RUB', 'interval': 1000},
                    // {'url':'https://yobit.net/api/2/xrp_usd/trades', 'fiat':'USD', 'interval': 1000}]
                    // Connector.addRestServer('yobit', subscribe)
                    // Connector.pollServer('yobit')
                    // Connector.on('yobit', (message) => {
                    //     if (message.data != null && Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             if (trade.date > Connector.getLastTradeID('yobit', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.trade_type == 'ask') ? true:false
                    //                     Rosetta.publish('yobit', message.fiat, trade.amount, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('yobit', message.fiat, trade.date)
                    //             }
                    //         })
                    //     }
                    // })

                    // subscribe = [{'url':'https://api.btc-exchange.com/papi/web/trades?market=xrpeur&limit=50&order_by=asc', 'fiat':'EUR', 'interval': 1000}]
                    // Connector.addRestServer('btc-exchange', subscribe)
                    // Connector.pollServer('btc-exchange')
                    // Connector.on('btc-exchange', (message) => {
                    //     if (message.data != null && Array.isArray(message.data)) {
                    //         let trades = message.data
                    //         trades.forEach((trade, i) => {
                    //             if (trade.id > Connector.getLastTradeID('btc-exchange', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.side == 'sell') ? true:false
                    //                     Rosetta.publish('btc-exchange', message.fiat, trade.volume, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('btc-exchange', message.fiat, trade.id)
                    //             }
                    //         })
                    //     }
                    // })

                    subscribe = [{'url':'https://api.nobitex.ir/v2/trades/XRPIRT', 'fiat':'IRR', 'interval': 1000}]
                    Connector.addRestServer('nobitex', subscribe)
                    Connector.pollServer('nobitex')
                    Connector.on('nobitex', (message) => {
                        if (message.data != null &&  Array.isArray(message.data.trades)) {
                            let trades = message.data.trades.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.time > Connector.getLastTradeID('nobitex', 'IRR')) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        // the price in here is diff to display and other exchange
                                        // look at https://nobitex.ir/current-prices/
                                        Rosetta.publish('nobitex', 'IRR', trade.volume, trade.price / 10, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('nobitex', 'IRR', trade.time)
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://api.chainex.io/market/trades/XRP/ZAR', 'fiat':'ZAR', 'interval': 1000}]
                    Connector.addRestServer('chainex', subscribe)
                    Connector.pollServer('chainex')
                    Connector.on('chainex', (message) => {
                        if (message.data != null &&  Array.isArray(message.data.data)) {
                            let trades = message.data.data.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.time > Connector.getLastTradeID('chainex', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'SELL') ? true:false
                                        Rosetta.publish('chainex', message.fiat, trade.amount, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('chainex', message.fiat, trade.time)
                                }
                            })
                        }
                    })

                    // subscribe = [{'url':'https://folgory.com/market/trade?symbol=XRP_EUR', 'fiat':'EUR', 'interval': 5000}]
                    // Connector.addRestServer('folgory', subscribe)
                    // Connector.pollServer('folgory')
                    // Connector.on('folgory', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             if (trade.id > Connector.getLastTradeID('folgory', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.Type == 'sell') ? true:false
                    //                     Rosetta.publish('folgory', message.fiat, trade.qty, trade.amount, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('folgory', message.fiat, trade.id)
                    //             }
                    //         })
                    //     }
                    // })


                    subscribe = [{'url':'https://partner.gdac.com/v0.4/public/trades?pair=XRP/KRW', 'fiat':'KRW', 'interval': 1000}]
                    Connector.addRestServer('gdac', subscribe)
                    Connector.pollServer('gdac')
                    Connector.on('gdac', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                if (Date.parse(trade.trade_dtime) > Connector.getLastTradeID('gdac', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = true // not given
                                        Rosetta.publish('gdac', message.fiat, trade.quantity, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('gdac', message.fiat, Date.parse(trade.trade_dtime))
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://api.coinmetro.com/exchange/ticks/XRPUSD', 'fiat':'USD', 'interval': 5000},
                        {'url':'https://api.coinmetro.com/exchange/ticks/XRPGBP', 'fiat':'GBP', 'interval': 5000}]
                    Connector.addRestServer('coinmetro', subscribe)
                    Connector.pollServer('coinmetro')
                    Connector.on('coinmetro', (message) => {
                        if (message.data.tickHistory != null) {
                            let trades = message.data.tickHistory.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.timestamp > Connector.getLastTradeID('coinmetro', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = true // not given
                                        Rosetta.publish('coinmetro', message.fiat, trade.qty, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('coinmetro', message.fiat, trade.timestamp)
                                }
                            })
                        }
                    })

                    // subscribe = [{'url':'https://lucent.exchange/api/v2/trades?market=xrpusd&limit=100&order_by=desc', 'fiat':'USD', 'interval': 1000}]
                    // Connector.addRestServer('lucent-exchange', subscribe)
                    // Connector.pollServer('lucent-exchange')
                    // Connector.on('lucent-exchange', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             if (trade.id > Connector.getLastTradeID('lucent-exchange', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.side == 'sell') ? true:false
                    //                     Rosetta.publish('lucent-exchange', message.fiat, trade.volume, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('lucent-exchange', message.fiat, trade.id)
                    //             }
                    //             Connector.setArguments('lucent-exchange', message.fiat, '&from=' + trade.id)
                    //         })
                    //     }
                    // })

                    // 500 error off line..
                    // subscribe = [{'url':'https://www.bitinka.com/api/apinka/order_history/XRP_USD?format=json', 'fiat':'USD', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_EUR?format=json', 'fiat':'EUR', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_PEN?format=json', 'fiat':'PEN', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_ARS?format=json', 'fiat':'ARS', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_BOB?format=json', 'fiat':'BOB', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_BRL?format=json', 'fiat':'BRL', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_CLP?format=json', 'fiat':'CLP', 'interval': 3000},
                    //         {'url':'https://www.bitinka.com/api/apinka/order_history/XRP_COP?format=json', 'fiat':'COP', 'interval': 3000}]
                    // Connector.addRestServer('bitinka', subscribe)
                    // Connector.pollServer('bitinka')
                    // Connector.on('bitinka', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             if (Date.parse(trade.datetime) > Connector.getLastTradeID('bitinka', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.Type == 'SELL') ? true:false
                    //                     Rosetta.publish('bitinka', message.fiat, trade.Amount, trade.Price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('bitinka', message.fiat, Date.parse(trade.datetime))
                    //             }
                    //         })
                    //     }
                    // })

                    // lots of 503
                    // subscribe = [{'url':'https://colodax.com/api/trades/XRP_INR', 'fiat':'INR', 'interval': 12000}]
                    // Connector.addRestServer('colodax', subscribe)
                    // Connector.pollServer('colodax')
                    // Connector.on('colodax', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             if (trade.trade_id > Connector.getLastTradeID('colodax', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.type == 'sell') ? true:false
                    //                     Rosetta.publish('colodax', message.fiat, trade.base_volume, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('colodax', message.fiat, trade.trade_id)
                    //             }
                    //         })
                    //     }
                    // })

                    subscribe = [{'url':'https://api.miraiex.com/v2/markets/XRPNOK/history', 'fiat':'NOK', 'interval': 1000}]
                    Connector.addRestServer('miraiex', subscribe)
                    Connector.pollServer('miraiex')
                    Connector.on('miraiex', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                if (Date.parse(trade.created_at) > Connector.getLastTradeID('miraiex', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'ask') ? true:false
                                        Rosetta.publish('miraiex', message.fiat, trade.amount, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('miraiex', message.fiat, Date.parse(trade.created_at))
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://www.quidax.com/api/v1/trades/xrpngn', 'fiat':'NGN', 'interval': 1000}]
                    Connector.addRestServer('quidax', subscribe)
                    Connector.pollServer('quidax')
                    Connector.on('quidax', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()

                            trades.forEach((trade, i) => {
                                if (trade.id > Connector.getLastTradeID('quidax', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = true // none provided
                                        Rosetta.publish('quidax', message.fiat, trade.volume, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('quidax', message.fiat, trade.id)
                                }
                            })
                        }
                    })

                    // now has websocket https://support.bithash.net/hc/en-us/articles/4418691224973-Websocket-API
                    subscribe = [{'url':'https://www.bithash.net/api/v4/trades/XRP_EUR', 'fiat':'EUR', 'interval': 1000},
                        {'url':'https://www.bithash.net/api/v4/trades/XRP_USD', 'fiat':'USD', 'interval': 1000},
                        {'url':'https://www.bithash.net/api/v4/trades/XRP_RUB', 'fiat':'RUB', 'interval': 1000}]
                    Connector.addRestServer('bithash', subscribe)
                    Connector.pollServer('bithash')
                    Connector.on('bithash', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()

                            trades.forEach((trade, i) => {
                                if (trade.trade_id > Connector.getLastTradeID('bithash', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('bithash', message.fiat, trade.quote_volume, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('bithash', message.fiat, trade.trade_id)
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://api.bitexbook.com/api/public/trades/XRP_RUB', 'fiat':'RUB', 'interval': 3000},
                        {'url':'https://api.bitexbook.com/api/public/trades/XRP_UAH', 'fiat':'UAH', 'interval': 3000},
                        {'url':'https://api.bitexbook.com/api/public/trades/XRP_USDT', 'fiat':'USDT', 'interval': 3000}]
                    Connector.addRestServer('bitexbook', subscribe)
                    Connector.pollServer('bitexbook')
                    Connector.on('bitexbook', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()

                            trades.forEach((trade, i) => {
                                if (trade.trade_timestamp > Connector.getLastTradeID('bitexbook', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('bitexbook', message.fiat, trade.quote_volume, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('bitexbook', message.fiat, trade.trade_timestamp)
                                }
                            })
                        }
                    })

                    // subscribe = [{'url':'https://api.coinzo.com/trades?pair=XRP-TRY', 'fiat':'TRY', 'interval': 1000}]
                    // Connector.addRestServer('coinzo', subscribe)
                    // Connector.pollServer('coinzo')
                    // Connector.on('coinzo', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()

                    //         trades.forEach((trade, i) => {
                    //             if (trade.created_at > Connector.getLastTradeID('coinzo', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.type == 'SELL') ? true:false
                    //                     Rosetta.publish('coinzo', message.fiat, trade.amount, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('coinzo', message.fiat, trade.created_at)
                    //             }
                    //         })
                    //     }
                    // })

                    // subscribe = [{'url':'https://cex.io/api/trade_history/XRP/EUR', 'fiat':'EUR', 'interval': 4000},
                    //     {'url':'https://cex.io/api/trade_history/XRP/GBP', 'fiat':'GBP', 'interval': 4000},
                    //     {'url':'https://cex.io/api/trade_history/XRP/USD', 'fiat':'USD', 'interval': 4000}]
                    // Connector.addRestServer('cexio', subscribe)
                    // Connector.pollServer('cexio')
                    // Connector.on('cexio', (message) => {
                    //     if (message.data != null && Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             //console.log(trade)
                    //             if (trade.tid > Connector.getLastTradeID('cexio', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.type == 'sell') ? true:false
                    //                     Rosetta.publish('cexio', message.fiat, trade.amount, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('cexio', message.fiat, trade.tid)
                    //             }
                    //         })
                    //     }
                    // })

                    subscribe = [{'url':'https://api2.tokenize.exchange/public/v1/market/history?market=SGD-XRP', 'fiat':'SGD', 'interval': 1000},
                        {'url':'https://api2.tokenize.exchange/public/v1/market/history?market=MYR-XRP', 'fiat':'MYR', 'interval': 1000},
                        {'url':'https://api2.tokenize.exchange/public/v1/market/history?market=XSGD-XRP', 'fiat':'XSGD', 'interval': 1000}]
                    Connector.addRestServer('tokeniz-exchange', subscribe)
                    Connector.pollServer('tokeniz-exchange')
                    Connector.on('tokeniz-exchange', (message) => {
                        if (message.data != null &&  Array.isArray(message.data.data)) {
                            let trades = message.data.data.reverse()

                            trades.forEach((trade, i) => {
                                if (trade.timeStamp > Connector.getLastTradeID('tokeniz-exchange', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('tokeniz-exchange', message.fiat, trade.amount, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('tokeniz-exchange', message.fiat, trade.timeStamp)
                                }
                            })
                        }
                    })

                    // subscribe = [
                    //     {'url':'https://api.therocktrading.com/v1/funds/EURXRP/trades', 'fiat':'EUR', 'interval': 1000}]
                    // Connector.addRestServer('therocktrading', subscribe)
                    // Connector.pollServer('therocktrading')
                    // Connector.on('therocktrading', (message) => {
                    //     //console.log(message)
                    //     if (message.data != null &&  Array.isArray(message.data.trades)) {
                    //         let trades = message.data.trades.reverse()

                    //         trades.forEach((trade, i) => {
                    //             if (trade.id > Connector.getLastTradeID('therocktrading', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.side != 'sell') ? true:false // pair fliped!
                    //                     Rosetta.publish('therocktrading', message.fiat, (trade.amount/trade.price), (1/trade.price), maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('therocktrading', message.fiat, trade.id)
                    //             }
                    //         })
                    //     }
                    // })


                    // subscribe = [{'url':'https://www.giottus.com/api/v2/trades?market=xrpinr', 'fiat':'INR', 'interval': 1000}]
                    // Connector.addRestServer('giottus', subscribe)
                    // Connector.pollServer('giottus')
                    // Connector.on('giottus', (message) => {

                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()

                    //         trades.forEach((trade, i) => {
                    //             //console.log(trade)
                    //             if (Date.parse(trade.created_at) > Connector.getLastTradeID('giottus', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.side == 'Sell') ? true:false
                    //                     Rosetta.publish('giottus', message.fiat, trade.volume, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('giottus', message.fiat, Date.parse(trade.created_at))
                    //             }
                    //         })
                    //     }
                    // })

                    subscribe = [{'url':'http://brasilbitcoin.com.br/API/transactions/XRP', 'fiat':'BRL', 'interval': 3000}]
                    Connector.addRestServer('brasil-bitcoin', subscribe)
                    Connector.pollServer('brasil-bitcoin')
                    Connector.on('brasil-bitcoin', (message) => {

                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()

                            trades.forEach((trade, i) => {
                                //console.log(trade)
                                if (trade.id > Connector.getLastTradeID('brasil-bitcoin', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.tipo == 'sell') ? true:false
                                        Rosetta.publish('brasil-bitcoin', message.fiat, trade.quantidade, trade.preco, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('brasil-bitcoin', message.fiat, trade.id)
                                }
                            })
                        }
                    })

                    
                    subscribe = [{'url':'https://indodax.com/api/trades/xrpidr', 'fiat':'IDR', 'interval': 1000}]
                    Connector.addRestServer('indodax', subscribe)
                    Connector.pollServer('indodax')
                    Connector.on('indodax', (message) => {
                        if (message.data != null &&  Array.isArray(message.data)) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                //console.log(trade)
                                if (trade.tid > Connector.getLastTradeID('indodax', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('indodax', message.fiat, trade.amount, trade.price, maker, type, debug)    
                                    }
                                    Connector.setLastTradeID('indodax', message.fiat, trade.tid)
                                }
                            })
                        }
                    })

                    // subscribe = [{'url':'https://www.zebapi.com/pro/v1/market/XRP-INR/trades', 'fiat':'INR', 'interval': 1000}]
                    // Connector.addRestServer('zebpay', subscribe)
                    // Connector.pollServer('zebpay')
                    // Connector.on('zebpay', (message) => {
                    //     if (message.data != null &&  Array.isArray(message.data)) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                    //             //console.log(trade)
                    //             if (trade.trans_id > Connector.getLastTradeID('zebpay', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.fill_flags == 1) ? true:false
                    //                     Rosetta.publish('zebpay', message.fiat, trade.fill_qty / 1000000, trade.fill_price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('zebpay', message.fiat, trade.trans_id)
                    //             }
                    //         })
                    //     }
                    // })

                    // subscribe = [{'url':'https://api.remitano.com/api/v1/markets/xrpngn/trades', 'fiat':'NGN', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpinr/trades', 'fiat':'INR', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrptzs/trades', 'fiat':'TZS', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpkes/trades', 'fiat':'KES', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrppkr/trades', 'fiat':'PKR', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpmyr/trades', 'fiat':'MYR', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpvnd/trades', 'fiat':'VND', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpves/trades', 'fiat':'VES', 'interval': 9000},
                    //     {'url':'https://api.remitano.com/api/v1/markets/xrpzar/trades', 'fiat':'ZAR', 'interval': 9000}]
                    // Connector.addRestServer('remitano', subscribe)
                    // Connector.pollServer('remitano')
                    // Connector.on('remitano', (message) => {
                    //     //console.log(message)
                    //     if (message.data != null) {
                    //         let trades = message.data.reverse()
                    //         trades.forEach((trade, i) => {
                                
                    //             if (Date.parse(trade.timestamp) > Connector.getLastTradeID('remitano', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.type == 'sell') ? true:false
                    //                     Rosetta.publish('remitano', message.fiat, trade.coin_amount, trade.price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('remitano', message.fiat, Date.parse(trade.timestamp))
                    //             }
                    //         })
                    //     }
                    // })

                    subscribe = [{'url':'https://hft-apiv2-grpc.lykke.com:443/api/trades/public/XRPUSD', 'fiat':'USD', 'interval': 1000},
                        {'url':'https://hft-apiv2-grpc.lykke.com:443/api/trades/public/XRPCHF', 'fiat':'CHF', 'interval': 1000},
                        {'url':'https://hft-apiv2-grpc.lykke.com:443/api/trades/public/XRPEUR', 'fiat':'EUR', 'interval': 1000}]
                    Connector.addRestServer('lykke', subscribe)
                    Connector.pollServer('lykke')
                    Connector.on('lykke', (message) => {
                        let trades = message.data.payload.reverse()
                        trades.forEach((trade, i) => {
                            //console.log(trade)
                            if (trade.timestamp > Connector.getLastTradeID('lykke', message.fiat)) {
                                if (message.skip_first) {
                                    const maker = (trade.side == 'sell') ? true:false
                                    Rosetta.publish('lykke', message.fiat, trade.volume, trade.price, maker, type, debug)
                                }
                                Connector.setLastTradeID('lykke', message.fiat, trade.timestamp)
                            }
                        })
                    })

                    subscribe = [{'url':'https://api.bittrex.com/v3/markets/XRP-USD/trades', 'fiat':'USD', 'interval': 1000},
                        {'url':'https://api.bittrex.com/v3/markets/XRP-EUR/trades', 'fiat':'EUR', 'interval': 1000}]
                    Connector.addRestServer('bittrex', subscribe)
                    Connector.pollServer('bittrex')
                    Connector.on('bittrex', (message) => {
                        if (message.data != null) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                if (Date.parse(trade.executedAt) > Connector.getLastTradeID('bittrex', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.takerSide == 'SELL') ? true:false
                                        Rosetta.publish('bittrex', message.fiat, trade.quantity, trade.rate, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('bittrex', message.fiat, Date.parse(trade.executedAt))
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://api.coinone.co.kr/trades?currency=XRP', 'fiat':'KRW', 'interval': 1000}]
                    Connector.addRestServer('coinone', subscribe)
                    Connector.pollServer('coinone')
                    Connector.on('coinone', (message) => {

                        if ('completeOrders' in message.data && message.data.completeOrders != null) {
                            let trades = message.data.completeOrders.reverse()
                            trades.forEach((trade, i) => {
                                //console.log(trade)
                                if (trade.id > Connector.getLastTradeID('coinone', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.is_ask == '0') ? true:false
                                        Rosetta.publish('coinone', message.fiat, trade.qty, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('coinone', message.fiat, trade.id)
                                }
                            })
                        }
                    })
                    
                    // subscribe = [{'url':'https://api.cashierest.com/V2/PbV12/RecentTransactions?PaymentCurrency=KRW&CoinCode=XRP', 'fiat':'KRW', 'interval': 1000}]
                    // Connector.addRestServer('cashierest', subscribe)
                    // Connector.pollServer('cashierest')
                    // Connector.on('cashierest', (message) => {

                    //     if (message.data != null && message.data.ReturnData != null && message.data.ReturnData.length > 0) {
                    //         let trades = message.data.ReturnData.reverse()
                    //         //console.log(message.data)
                    //         trades.forEach((trade, i) => {
                    //             // console.log(trade)
                    //             if (trade.TransactionID > Connector.getLastTradeID('cashierest', message.fiat)) {
                    //                 if (message.skip_first) {
                    //                     const maker = (trade.ResentType == 'Bid') ? true:false
                    //                     Rosetta.publish('cashierest', message.fiat, trade.UnitTraded, trade.Price, maker, type, debug)
                    //                 }
                    //                 Connector.setLastTradeID('cashierest', message.fiat, trade.TransactionID)
                    //             }
                    //         })
                    //     }
                    // })


                    subscribe = [{'url':'https://openapi.bitrue.com/api/v1/trades?symbol=XRPBUSD', 'fiat':'BUSD', 'interval': 3000},
                        {'url':'https://openapi.bitrue.com/api/v1/trades?symbol=XRPUSDT', 'fiat':'USDT', 'interval': 3000},
                        {'url':'https://openapi.bitrue.com/api/v1/trades?symbol=XRPUSDC', 'fiat':'USDC', 'interval': 3000}]
                    Connector.addRestServer('bitrue', subscribe)
                    Connector.pollServer('bitrue')
                    Connector.on('bitrue', (message) => {
                        // log(message.data)
                        if (message.data != null && Array.isArray(message.data)) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.id > Connector.getLastTradeID('bitrue', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.isBuyerMaker == true) ? true:false
                                        Rosetta.publish('bitrue', message.fiat, trade.qty, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('bitrue', message.fiat, trade.id)
                                }
                            })
                        }
                    })

                    subscribe = [{'url':'https://api.bitoasis.net/v1/exchange/trades/XRP-AED', 'fiat':'AED', 'interval': 1000}, {'url':'https://api.bitoasis.net/v1/exchange/trades/XRP-SAR', 'fiat':'AED', 'interval': 1000}]
                    Connector.addRestServer('bitoasis', subscribe)
                    Connector.pollServer('bitoasis')
                    Connector.on('bitoasis', (message) => {
                        if (message.data != null && Array.isArray(message.data.trades)) {
                            let trades = message.data.trades.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.id > Connector.getLastTradeID('bitoasis', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'sell') ? true:false
                                        Rosetta.publish('bitoasis', message.fiat, trade.amount, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('bitoasis', message.fiat,trade.id)
                                }
                            })
                        }
                    })

                    // has been renamed from unodax
                    subscribe = [{'url':'https://api.unocoin.com/api/v1/exchange/historical_trades?ticker_id=XRP_INR&depth=100&type=buy', 'fiat':'INR', 'interval': 2000}]
                    Connector.addRestServer('unodax', subscribe)
                    Connector.pollServer('unodax')
                    Connector.on('unodax', (message) => {
                        if (message.data != null) {
                            let trades = message.data.reverse()
                            trades.forEach((trade, i) => {
                                if (trade.trade_id > Connector.getLastTradeID('unodax', message.fiat)) {
                                    if (message.skip_first) {
                                        const maker = (trade.type == 'SELL') ? true:false
                                        Rosetta.publish('unodax', message.fiat, trade.target_volume, trade.price, maker, type, debug)
                                    }
                                    Connector.setLastTradeID('unodax', message.fiat, trade.trade_id)
                                }
                            })
                        }
                    })   
                }catch(e) {
                    log('pollrest error', e)
                }
            },
            connectSocketsStable() {
                let subscribe = []
                const debug = false
                const type = 'socket'
                const id = Date.now()

                subscribe = [{
                    'topic': 'trade',
                    'params': {
                        'symbol': 'XRPUSDC',
                        'binary': false
                    },
                    'event': 'sub'
                },{
                    'topic': 'trade',
                    'params': {
                        'symbol': 'XRPUSDT',
                        'binary': false
                    },
                    'event': 'sub'
                },{
                    'topic': 'trade',
                    'params': {
                        'symbol': 'XRPEUR',
                        'binary': false
                    },
                'event': 'sub' 
                },{
                    'topic': 'trade',
                    'params': {
                        'symbol': 'XRPBTC',
                        'binary': false
                    },
                'event': 'sub' }]

                Connector.addWebSocket('bybit', 'wss://stream.bybit.com/spot/quote/ws/v2', ['USDT', 'USDC', 'EUR', 'BTC'], subscribe)
                Connector.listenHeartBeat('bybit')
                Connector.setHeartBeat('bybit', 'PING', 10000)
                Connector.on('bybit', (message) => {
                    const data = JSON.parse(message.data)
                    if ('event' in data) { return }
                    const maker = (data.data.m == false) ? true:false
                    Rosetta.publish('bybit', data.params.symbol.substring(3, data.params.symbol.length), data.data.q, data.data.p, maker, type, debug)
                    
                })

                subscribe = [{'id': id, 'method': 'subscribe', 'params': {'channels': ['trade.XRP_USD', 'trade.XRP_USDT', 'trade.XRP_USDC', 'trade.XRP_PYUSD', 'trade.XRP_BTC']}, 'nonce': id }]
                Connector.addWebSocket('cryptocom', 'wss://stream.crypto.com/v2/market', ['USD', 'USDT', 'USDC', 'PYUSD', 'BTC'], subscribe)
                Connector.on('cryptocom', (message) => {

                    let data = JSON.parse(message.data)

                    if (data.method == 'public/heartbeat') { 
                        Connector.send('cryptocom', JSON.stringify({ 'id': data.id, 'method': 'public/respond-heartbeat' }))
                        return 
                    }
                    if (!('result' in data)) { return }
                    if (!('data' in data.result)) { return }

                    data.result.data.forEach((trade, i) => {
                        const maker = (trade.s == 'Sell') ? true:false
                        Rosetta.publish('cryptocom', trade.i.substring(4, trade.i.length).toUpperCase(), trade.q, trade.p, maker, type, debug)
                    })
                })

                subscribe = [{'event': 'subscribe',
                    'arg': [{
                        'instType': 'sp',
                        'channel': 'trade',
                        'instId': 'XRPUSDT'
                    }]
                },{'event': 'subscribe',
                    'arg': [{
                        'instType': 'sp',
                        'channel': 'trade',
                        'instId': 'XRPUSDC'
                    }]
                }]
                
                Connector.addWebSocket('bitget-global', 'wss://ws.bitget.com/mix/v1/stream', ['USDT', 'USDC'], subscribe)
                Connector.listenHeartBeat('bitget-global')
                Connector.setHeartBeat('bitget-global', JSON.stringify({'op': 'ping'}), 10000)
                Connector.on('bitget-global', (message) => {
                    if (message.data == 'pong') { return }
                    const data = JSON.parse(message.data)
                    if (!('data' in data)) { return }
                    if (bitgetSkip != false) { 
                        bitgetSkip = false 
                        return 
                    } 
                    data.data.forEach(function (trade, index) {
                       const maker = (trade[3] == 'sell') ? true:false
                       Rosetta.publish('bitget-global', data.arg.instId.substring('XRP'.length), trade[2], trade[1], maker, type, debug) 
                    })
                })

                subscribe = [{'id':id, 'method':'trades.subscribe', 'params':['XRP_USDT', 'XRP_BTC', 'XRP_ETH']}]
                Connector.addWebSocket('digifinex', 'wss://openapi.digifinex.com/ws/v1/', ['USDT', 'BTC', 'ETH'], subscribe)
                Connector.listenHeartBeat('digifinex')
                Connector.setHeartBeat('digifinex', JSON.stringify({'id':id, 'method':'server.ping', 'params':[]}), 20000)
                Connector.on('digifinex', (message) => {
                    let pakodata = new Uint8Array(message.data)
                    const data = JSON.parse(pako.inflate(pakodata, { to: 'string' }))
                    if (!('method' in data)) { return }
                    if ( data.method != 'trades.update') { return }
                    data.params[1].forEach((trade, i) => {
                        const maker = (trade.type == 'sell') ? true:false
                        Rosetta.publish('digifinex', data.params[2].substring(4), trade.amount, trade.price, maker, type, debug)
                    })
                })
            },
            async test() {
                let subscribe = []
                const debug = true
                const type = 'socket'
                const id = new Date().getTime()

                // Connector.addWebSocket('luno-sol', 'wss://ws.luno.com/api/1/stream/SOLXRP', ['SOL'], subscribe)
                // Connector.listenHeartBeat('luno-sol')
                // Connector.setHeartBeat('luno-sol', JSON.stringify({}), 10000)
                // Connector.on('luno-sol', (message) => {
                //     const data = JSON.parse(message.data)
                //     if (data.trade_updates == null) { return }
                //     if (data.trade_updates.length <= 0) { return }
                    
                //     data.trade_updates.forEach(function (trade, index) {
                //         log(trade)
                //         const maker = false //data.create_update != null ? data.create_update.order_id == trade.maker_order_id ? true:false : false
                //         Rosetta.publish('luno', 'SOL', trade.base, trade.counter / trade.base, maker, type, debug) 
                //     })
                // })
               
                
                subscribe = [{'event':'sub','topic':'xrp_usdt.trade,xrp_usdc.trade'}]
                Connector.addWebSocket('bkex', 'wss://fapi.bkex.com/fapi/v2/ws', ['USDT', 'USDC'], subscribe)
                Connector.listenHeartBeat('bkex')
                Connector.on('bkex', (message) => {
                    const data = JSON.parse(message.data)
                    log('data', data)
                    // dont spot ping...
                    // Connector.setHeartBeat('bkex', JSON.stringify({'pong': 'pong'}), false)
                    if (!data.type.includes('trade')) { 
                        // log('data', data)
                        return }
                    const maker = (data.data[1] == 1) ? true:false
                    Rosetta.publish('bkex', data.type.split('.')[0].substring('xrp_'.length).toUpperCase(), data.data[2]*1, data.data[0]*1, maker, type, debug)
                    
                })


                // subscribe = [{
                //     'id':id,
                //     'reqType': 'sub',
                //     'dataType':'BTC-USDT@trade'
                // }]
                // Connector.addWebSocket('bingx', 'wss://open-api-swap.bingx.com/swap-market', ['USDT'], subscribe)
                // Connector.listenHeartBeat('bingx')
                // Connector.on('bingx', (message) => {
                //     log(message.data)
                //     const buf = Buffer.from(message.data)
                //     const data = zlib.gunzipSync(buf).toString('utf-8')
                //     log(data)
                //     if (data === 'Ping') {
                //         Connector.setHeartBeat('bingx', JSON.stringify('Pong'), false)
                //         return
                //     }
                // })

                //     // if (!Array.isArray(data.data)) { return }
                //     // if (!('arg' in data)) { return }
                //     // if (!('channel' in data.arg)) { return }
                //     // if (data.arg.channel != 'trades') { return }
                //     // data.data.forEach((trade, i) => {
                //     //     const maker = (trade.side == 'sell') ? true:false
                //     //     Rosetta.publish('okx', trade.instId.substring(4), trade.sz, trade.px, maker, type, debug)
                //     // })
                // })

            }
        })
    }
}
