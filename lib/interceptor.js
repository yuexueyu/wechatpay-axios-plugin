import rsa from './rsa.js'
import fmt from './formatter.js'
import utils from 'axios/lib/utils.js'

import assert from 'assert'

/**
 * `Axios.interceptors` registry a request(for APIv3 Authorization)
 *                           and a response(for APIv3 Verification)
 *
 * @param {AxiosStatic} axios
 * @param {string} mchid The merchant ID
 * @param {string} serial The serial number of the merchant public certification
 * @param {string|Buffer} privateKey The merchant private key certification
 * @param {Object} certs Pair of the `{serial: publicCert}`
 *
 * @returns {AxiosStatic}
 * @constructor
 */
const interceptor = (axios, {
  mchid      = undefined,
  serial     = String,
  privateKey = undefined,
  certs      = Object,
} = {
  mchid      : undefined,
  serial     : undefined,
  privateKey : undefined,
  certs      : Object,
}) => {

  assert(utils.isString(mchid) || utils.isNumber(mchid),
    'The merchant\' ID aka `mchid` is required, usually numerical.'
  )
  assert(utils.isString(serial),
    'The serial number of the merchant\'s public certification '
    + 'aka `serial` is required, usually hexadecial.'
  )
  assert(utils.isString(privateKey) || utils.isBuffer(privateKey),
    'The merchant\'s private key certification '
    + 'aka `privateKey` is required, usual as pem format.'
  )
  assert(utils.isObject(certs) && Object.keys(certs).length > 0,
    'The public certifications via API downloaded '
    + '`certs` is required, '
    + 'similar and just the pair of `{serial: publicCert}` Object.'
  )

  // Add a new interceptor to the HTTP(s) request stack
  axios.interceptors.request.use(config => {
    const method    = config.method.toUpperCase()
    const payload   = JSON.stringify(config.data)
    const nonce     = fmt.nonce()
    const timestamp = fmt.timestamp()
    // `getUri` should missing some paths whose where on `baseURL`
    const url       = new URL(axios.getUri(config), config.baseURL)
    // sign the request by the merchant private key certification
    const signature = rsa.sign(
      fmt.request(method, `${url.pathname}${url.search}`, timestamp, nonce, payload),
      privateKey
    )

    config.headers = {
      ...config.headers,
      'Content-Type' : `application/json`,
      Accept         : `application/json`,
      // @see {fmt.authorization} APIv3 `Authorization` schema
      Authorization  : fmt.authorization(mchid, nonce, signature, timestamp, serial),
    }

    return config
  })

  // Add a new interceptor to the HTTP(s) response stack
  axios.interceptors.response.use(response => {
    const timestamp = response.headers[`wechatpay-timestamp`]
    const nonce     = response.headers[`wechatpay-nonce`]
    const serial    = response.headers[`wechatpay-serial`]
    const signature = response.headers[`wechatpay-signature`]
    const payload   = JSON.stringify(response.data)

    assert.ok(
      // @see {rsa.verify} verify the response by the wechatpay public certification
      rsa.verify(fmt.response(timestamp, nonce, payload), signature, certs[serial]),
      'Verify the response with '
      + `timestamp=${timestamp}, nonce=${nonce}, `
      + `signature=${signature}, cert={${serial}: publicCert} failed.`
    )

    const localTimestamp = fmt.timestamp()
    assert.ok(
      // here's only allowed with negative and positive 5 minutes
      Math.abs(localTimestamp - timestamp) < 300,
      `The response was on ${timestamp}, your local is ${localTimestamp}. `
      + `Here's only allowed with negative and positive 5 minutes. `
      + `Please keeping your machine's datetime synchronized.`
    )

    return response
  })

  return axios
}

export default interceptor