import _ from 'lodash'
import axios from 'axios'
import { timeStamp } from '../utils/Helpers.mjs'

class Health {
  constructor(config, opts) {
    const { tenant, address, uuid, name, apiKey, timeout, gracePeriod } = config || {}
    const { dryRun, networkName } = opts || {}
    this.tenant = tenant
    this.address = address || 'https://hc-ping.com'
    this.name = name || networkName
    this.gracePeriod = gracePeriod || 86400   // default 24 hours
    this.timeout = timeout || 86400           // default 24 hours
    this.uuid = uuid
    this.apiKey = apiKey
    this.dryRun = dryRun
    this.logs = []
    this.getOrCreateHealthCheck()

    if (address) {
      // This is necessary as the default provider - hc-ping.com - has a built in ping mechanism
      // whereas providing self-hosted addresses do NOT. 
      // https://healthchecks.selfhosted.com/ping/{uuid} rather than https://hc-ping.com/{uuid}
      if (!this.address.includes("slack")) {
        this.address = this.address + "/ping"
      }
    }
  }

  started(...args) {
    timeStamp(...args)
    if (this.uuid) timeStamp('Starting health', [this.address, this.uuid].join('/'))
    return this.ping('start', [args.join(' ')])
  }

  success(...args) {
    timeStamp(...args)
    return this.ping(undefined, [...this.logs, args.join(' ')])
  }

  failed(...args) {
    timeStamp(...args)
    return this.ping('fail', [...this.logs, args.join(' ')])
  }

  log(...args) {
    timeStamp(...args)
    this.logs = [...this.logs, args.join(' ')]
  }

  addLogs(logs) {
    this.logs = this.logs.concat(logs)
  }

  async getOrCreateHealthCheck(...args) {
    if (!this.apiKey) return;

    let config = {
      headers: {
        "X-Api-Key": this.apiKey,
      }
    }

    let data = {
      "name": this.name, "channels": "*", "timeout": this.timeout, "grace": this.gracePeriod, "unique": ["name"]
    }

    try {
      await axios.post([this.address, 'api/v2/checks/'].join('/'), data, config).then((res) => {
        this.uuid = res.data.ping_url.split('/')[4]
      });
    } catch (error) {
      timeStamp("Health Check creation failed: " + error)
    }
  }

  async sendLog() {
    await this.ping('log', this.logs)
    this.logs = []
  }

  async ping(action, logs) {
    if (!this.uuid) return
    if (this.dryRun) return timeStamp('DRYRUN: Skipping health check ping')

    let target_url = ""
    let dat2 = ""
    if (this.address.includes("hc-ping") || this.address.includes("/ping")) {
      target_url = _.compact([this.address, this.uuid, action]).join('/')
      dat2 = logs.join("\n")
    } else {
      let msg = ""

      if (typeof action === 'undefined') {
        msg = "restake: " + this.name + " " + this.tenant + "\n" + "OK\n" + logs.join("\n")
      } else {
        msg = "restake: " + this.name + " " + this.tenant + "\n" + action + "\n" + logs.join("\n")
      }

      let dat = {
        text: msg
      }

      target_url = _.compact([this.address]).join('/')
      dat2 = JSON.stringify(dat)

      // if tx failed, alert #cosmos-alerts in addition to #cosmos-restake-logs
      if (action == "fail") {
        axios.request({
          method: 'POST',
          url: this.uuid,
          data: dat2
        }).catch(error => {
          timeStamp('Health extra ping failed', error.message)
        })
      }
    }

    return axios.request({
      method: 'POST',
      url: target_url,
      data: dat2
    }).catch(error => {
      timeStamp('Health ping failed', error.message)
    })
  }
}

export default Health