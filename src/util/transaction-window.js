'use strict'

/**
 * Keep a transaction window.
 */
module.exports = class TransactionWindow {
  // First in First out
  constructor(name, time = null) {
    
    this.name  = name
    this.time = (time == null) ? 180000 : time // 3 min default
    this.fifo = []
  }

  /**
   * Add an item to the fifo queue.
   */
  add(item) {
    item.unixtime = Date.now()
    this.fifo.unshift(item)
    this.prune(item.unixtime)
    //console.log(this.name + ' size: ' + this.fifo.length)
  }

  /**
   * Trim the array to window size.
   */
  prune(newItemTime) {
    if (this.fifo.length <= 0) { return }

    // get first item in queue
    let item = this.fifo.pop()

    // validate ellapsed time not passed for last item
    if (newItemTime < item.unixtime + this.time) {
      this.fifo.push(item)
      return
    } 

    // since the last was removed try take another one off
    this.prune(newItemTime)
    // console.log('removed an item')
  }

  /**
   * Returns the queue name
   */
  get_name() {
    return this.name
  }

  /**
   * Returns the queue
   */
  get_queue() {
    return this.fifo
  }
}
