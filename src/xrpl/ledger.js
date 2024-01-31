'use strict'

const { XrplClient } = require('xrpl-client')
const EventEmitter = require('events')
const Axios = require('axios')
const https = require('https')
const GeoLocate = require('../util/geo.js')
const decimal = require('decimal.js')
const debug = require('debug') 

const log = debug('threexrp:xrpl:classifier')
class Ledger extends EventEmitter {
    constructor(Config) {
        super()

        const Geo = new GeoLocate()
        let xrpl = new XrplClient(['wss://xrpl.panicbot.xyz', 'wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com'])

        let AddressData = null
        let AccountData = null
        let PubSubManager = null
        let ledger_errors = 0
        let paymentCounter = 0
        let exchangeCounter = 0
        let nftCounter = 0
        let txCounter = 0

        Object.assign(this, {
            async checkConnection() {
                const books = {
                    'id': 4,
                    'command': 'book_offers',
                    'taker': 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8',
                    'taker_gets': {'currency': 'USD', 'issuer': 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
                    'taker_pays': {'currency': 'XRP' },
                    'limit': 100
                }

                const result = await xrpl.send(books)
                if ('error' in result) {
                    ledger_errors++
                    log('error', result.error)
                }
                if (ledger_errors > 2) {
                    xrpl.reinstate({forceNextUplink: true})
                    log('reinstate client', await xrpl.send({ command: 'server_info' }))
                    ledger_errors = 0
                }
                
            },
            async classifyPayments() {
                const self = this
                setInterval(() => {
                    self.checkConnection()
                }, 5_000)

                await this.setAddressData()
                // await this.setAccountData()
                
                xrpl.on('ledger', async (event) => {
                    paymentCounter = 0
                    exchangeCounter = 0
                    nftCounter = 0
                    const request = {
                        'id': 'xrpl-local',
                        'command': 'ledger',
                        'ledger_hash': event.ledger_hash,
                        'ledger_index': 'validated',
                        'transactions': true,
                        'expand': true,
                        'owner_funds': true
                    }
                    const ledger_result = await xrpl.send(request)
                    log(`ledger close... ${ledger_result.ledger.ledger_index}`)
                    const transactions = ledger_result?.ledger?.transactions
                    txCounter = 0
                    for (let i = 0; i < transactions.length; i++) {
                        const transaction = transactions[i]
                        txCounter++
                        if (transaction.metaData.TransactionResult == 'tesSUCCESS') {
                            if (transaction.TransactionType == 'Payment') {
                                // log('payment', transaction)
                                self.classifyPayment(transaction)
                                self.classifyAccountPayment(transaction)
                                paymentCounter++
                            }
                            if (transaction.TransactionType == 'OfferCreate') {
                                self.deriveExchanges(transaction)
                            }
                            if (transaction.TransactionType == 'NFTokenAcceptOffer') {
                                nftCounter++
                            }
                        }
                    }
                    const info = {
                        Ledger: ledger_result.ledger.ledger_index,
                        PaymentCounter: paymentCounter,
                        ExchangeCounter: exchangeCounter,
                        Transactions: txCounter,
                        NFTExchangeCounter: nftCounter
                    }
                    // log(info)
                    PubSubManager.route(info, 'xrpl_info')
                })

                // reload addresses
                setInterval(async () => {
                    await self.setAddressData()
                    // await self.setAccountData()
                }, 3600_000)
            },
            async setAddressData() {
                log('address data loaded')
                const instance = Axios.create({
                    httpsAgent: new https.Agent({
                      rejectUnauthorized: false
                    })
                })
                const {data} = await instance.get('https://three-backend.panicbot.xyz/api/v3/geo-addresses')
                for (let index = 0; index < data.length; index++) {
                    data[index].name = data[index].name.replace(/\s+/g, '-').toLowerCase()
                }
                AddressData = data
            },
            async setAccountData() {
                const instance = Axios.create({
                    httpsAgent: new https.Agent({
                      rejectUnauthorized: false
                    })
                  })
                  const {data} = await instance.get('https://three-apps.panicbot.xyz/api/v4/geo-accounts')
                AccountData = data
            },
            classifyAccountPayment(transaction) {
                // log('classifyAccountPaymentsss')
                if (AccountData == null) { return }
                let deliveredAmount = null
                if (typeof transaction.metaData.delivered_amount == 'object') {
                    deliveredAmount = transaction.metaData.delivered_amount.value
                }
                else {
                    deliveredAmount = transaction.metaData.delivered_amount
                }
                // log('deliveredAmount', deliveredAmount)
                if (deliveredAmount == null) { return }
                let source_info = this.classifyAddress(transaction.Account)
                let destination_info = this.classifyAddress(transaction.Destination)


                if (source_info !== false && destination_info !== false) { return }

                if (!source_info) {
                    source_info = this.classifyAccount(transaction.Account)
                }
                if (!destination_info) {
                    destination_info = this.classifyAccount(transaction.Destination)
                }
                //check both addresses been clasified now
                if (source_info === false || destination_info === false) { return }

                // both GEO or one GEO and one exchange..

                log(`ELVIS!`, transaction)

                const coordinates = {}
                coordinates.origin = [1*source_info.lat, 1*source_info.lon]
                coordinates.destination = [1*destination_info.lat,1*destination_info.lon]
                log('geo', {coordinates, source_info, destination_info})
            },
            classifyAccount(account) {
                // there a lot of records here so call this once and pass it along ;)
                if (AccountData == null) { return false }
                for (var i = 0; i < AccountData.length; i++) {
                    if (AccountData[i].account == account) {
                        return AccountData[i]
                    }
                }

                return false
            },
            classifyPayment(transaction) {
                if (AddressData == null) { return }
                let deliveredAmount = null
                if (typeof transaction.metaData.delivered_amount == 'object') {
                    deliveredAmount = transaction.metaData.delivered_amount.value
                }
                else {
                    deliveredAmount = transaction.metaData.delivered_amount
                }
                // log('deliveredAmount', deliveredAmount)
                if (deliveredAmount == null) { return }
                
                const source_info = this.classifyAddress(transaction.Account)
                // log('source_info', source_info)
                let source_name = false
                if (source_info) {
                    source_name = ('name' in  source_info && source_info.name != null) ? source_info.name : false   
                }

                const destination_info = this.classifyAddress(transaction.Destination)
                let destination_name = false
                if (destination_info) {
                    destination_name =  ('name' in destination_info && destination_info.name != null) ? destination_info.name : false
                }

                // if source_name = destination_name throw away
                if (source_name == destination_name) { return }

                // if source_name or destination_name are not classified
                if (source_name == false || destination_name == false) { return }

                // if source_name and destination_name are classified
                if (source_name != false && destination_name != false) {
                    const record = this.getRecordInfo(transaction, source_info, destination_info)
                    this.interExchangePayment(record, source_info, destination_info)
                    return
                }
            },
            classifyAddress(address) {
                // there a lot of records here so call this once and pass it along ;)
                if (AddressData == null) { return false }
                for (var i = 0; i < AddressData.length; i++) {
                    if (AddressData[i].account == address) {
                        return AddressData[i]
                    }
                }

                return false
            },
            getRecordInfo(transaction, source_info, destination_info) {
                let deliveredAmount = 0
                let currency = 'XRP'
                if (typeof transaction.metaData.delivered_amount == 'object') {
                    deliveredAmount = transaction.metaData.delivered_amount.value
                    currency = this.currencyHexToUTF8(transaction.metaData.delivered_amount.currency)
                }
                else {
                    deliveredAmount = transaction.metaData.delivered_amount / 1_000_000
                }

                
                const source_name = source_info.name
                const destination_name = destination_info.name

                let domain = null 
                if (destination_info != false) {
                    domain = ('domain' in destination_info) ? destination_info.domain : null
                }

                let validated = false 
                if (destination_info != false) {
                    validated = ('validated' in destination_info) ? destination_info.validated : false
                }

                const info = {
                    'amount': deliveredAmount ,
                    'currency': currency,
                    'source': transaction.Account,
                    'source_name': (source_name != undefined) ? source_name : null,
                    'destination': transaction.Destination,
                    'destination_name': (destination_name != undefined) ? destination_name : null,
                    'destination_tag' : ('DestinationTag' in transaction) ? transaction.DestinationTag : null,
                    'source_tag' : ('SourceTag' in transaction) ? transaction.SourceTag : null,
                    'hash' : transaction.hash,
                    'domain' : domain,
                    'validated': validated
                }
                return info
            },
            currencyHexToUTF8(code) {
				if (code.length === 3)
					return code

				let decoded = new TextDecoder()
					.decode(this.hexToBytes(code))
				let padNull = decoded.length

				while (decoded.charAt(padNull - 1) === '\0')
					padNull--

				return decoded.slice(0, padNull)
			},
            hexToBytes(hex) {
				let bytes = new Uint8Array(hex.length / 2)

				for (let i = 0; i !== bytes.length; i++) {
					bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
				}

				return bytes
			},
            interExchangePayment(info, source_info, destination_info) {
                // log('interExchangePayment')

                const coordinates = {}
                coordinates.origin = [1*source_info.lat, 1*source_info.lon]
                coordinates.destination = [1*destination_info.lat,1*destination_info.lon]
                info.geo = coordinates

                // log('info', info)
                if (PubSubManager != null) {
                    info.timestamp = new Date().getTime()
                    PubSubManager.route(info, 'xrpl')
                }
            },
            setPubSubManager(manager) {
                PubSubManager = manager
            },
            fromLedgerAmount(amount){
				if(typeof amount === 'string')
					return {
						currency: 'XRP',
						value: decimal.div(amount, '1000000')
					}
				
				return {
					currency: amount.currency,
					issuer: amount.issuer,
					value: new decimal(amount.value)
				}
			},
            async deriveExchanges(tx){
				let hash = tx.hash || tx.transaction.hash
				let maker = tx.Account || tx.transaction.Account
				let exchanges = []


				for(let affected of (tx.meta || tx.metaData).AffectedNodes){
					let node = affected.ModifiedNode || affected.DeletedNode
			
					if(!node || node.LedgerEntryType !== 'Offer')
						continue
			
					if(!node.PreviousFields || !node.PreviousFields.TakerPays || !node.PreviousFields.TakerGets)
						continue
			
					let taker = node.FinalFields.Account
					let sequence = node.FinalFields.Sequence
					let previousTakerPays = this.fromLedgerAmount(node.PreviousFields.TakerPays)
					let previousTakerGets = this.fromLedgerAmount(node.PreviousFields.TakerGets)
					let finalTakerPays = this.fromLedgerAmount(node.FinalFields.TakerPays)
					let finalTakerGets = this.fromLedgerAmount(node.FinalFields.TakerGets)
			
					let takerPaid = {
						...finalTakerPays, 
						value: previousTakerPays.value.minus(finalTakerPays.value)
					}
			
					let takerGot = {
						...finalTakerGets, 
						value: previousTakerGets.value.minus(finalTakerGets.value)
					}
			
					const trade ={
						hash,
						maker,
						taker,
						sequence,
						base: {
							currency: this.currencyHexToUTF8(takerPaid.currency), 
							issuer: takerPaid.issuer
						},
						quote: {
							currency: this.currencyHexToUTF8(takerGot.currency), 
							issuer: takerGot.issuer
						},
						price: takerGot.value.div(takerPaid.value).toFixed(),
						volume: takerPaid.value
					}
					exchanges.push(trade)

					// log('trade', trade)
                    exchangeCounter++
                    this.classifyAccountDexExchange(tx, trade)
				}
			
				return exchanges
			},
            classifyAccountDexExchange(transaction, trade) {
                // log('classifyAccountDexExchange')
                if (AccountData == null) { return }
                // if (trade.quote != 'XRP' && trade.base != 'XRP') { return }
                let source_info = this.classifyAccount(trade.maker)
                let destination_info = this.classifyAccount(trade.taker)
                if (!source_info) {
                    source_info = this.classifyAddress(trade.maker)
                }
                if (!destination_info) {
                    destination_info = this.classifyAddress(trade.taker)
                }
                //check both addresses been clasified now
                if (!source_info || !destination_info) { return }

                // both GEO or one GEO and one exchange..

                log(`ELVIS DEX!!!!`, trade)
                const coordinates = {}
                coordinates.origin = [1*source_info.lat, 1*source_info.lon]
                coordinates.destination = [1*destination_info.lat,1*destination_info.lon]
                log('geo', {coordinates, source_info, destination_info})
            },
        })
    }
}

module.exports = Ledger