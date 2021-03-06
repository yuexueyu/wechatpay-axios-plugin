const rsa = require('./rsa')
const fmt = require('./formatter')
const utils = require('./utils')

const assert = require('assert')

/**
 * @typedef {Object} apiConfig - The wechatpay consumer side configuration
 * @prop {string|number} mchid - The merchant ID
 * @prop {string} serial - The serial number of the merchant certificate
 * @prop {string|Buffer} privateKey - The merchant private key certificate
 * @prop {platformCertificates} certs - The wechatpay provider size configuration, `{serial: publicCert}` pair
 */
/**
 * @typedef {Object<string, string|Buffer>} platformCertificates
 */
 /**
 * register a named request as `signer`(for APIv3 Authorization)
 *      and a named response as `verifier`(for APIv3 Verification)
 * onto `Axios.interceptors`
 *
 * @param {!AxiosInstance} axios - The AxiosInstance
 * @param {!apiConfig} apiConfig - The wechatpay consumer side configuration
 *
 * @returns {AxiosInstance} - A decorated AxiosInstance
 * @constructor
 */
const interceptor = (axios, {
  mchid,
  serial,
  privateKey,
  certs,
} = {
  mchid: undefined,
  serial: undefined,
  privateKey: undefined,
  certs: Object,
}) => {

  assert(utils.isString(mchid) || utils.isNumber(mchid),
    'The merchant\' ID aka `mchid` is required, usually numerical.'
  )
  assert(utils.isString(serial),
    'The serial number of the merchant\'s public certificate '
    + 'aka `serial` is required, usually hexadecial.'
  )
  assert(utils.isString(privateKey) || utils.isBuffer(privateKey),
    'The merchant\'s private key certificate '
    + 'aka `privateKey` is required, usual as pem format.'
  )
  assert(utils.isObject(certs) && Object.keys(certs).length > 0,
    'The public certificates via API downloaded '
    + '`certs` is required, '
    + 'similar and just the pair of `{serial: publicCert}` Object.'
  )

  // Add a new interceptor named as `signer` to the HTTP(s) request stack
  axios.interceptors.request.use(function signer(config) {
    const method = config.method.toUpperCase()
    const payload = JSON.stringify(
      // for media upload, while this instance had `meta` Object defined,
      // let's checking whether or nor the real `data` is a `form-data`
      config.meta && utils.isProcessFormData(config.data) ?
        config.meta : config.data
    )
    const nonce = fmt.nonce()
    const timestamp = fmt.timestamp()
    // `getUri` should missing some paths whose were on `baseURL`
    const url = new URL(axios.getUri(config), config.baseURL)
    // sign the request by the merchant private key certificate
    const signature = rsa.sign(
      fmt.request(method, `${url.pathname}${url.search}`, timestamp, nonce, payload),
      privateKey
    )

    config.headers = {
      ...config.headers,
      'User-Agent': utils.userAgent(),
      'Content-Type': `application/json`,
      Accept: `application/json`,
      // @see {fmt.authorization} APIv3 `Authorization` schema
      Authorization: fmt.authorization(mchid, nonce, signature, timestamp, serial),
    }

    return config
  })

  // Add a new interceptor named as `verifier` to the HTTP(s) response stack
  axios.interceptors.response.use(function verifier(response) {
    // @see https://github.com/axios/axios/pull/128 for binary data
    // it's useful on `v3/billdownload/file` which's none verification required
    if (response.config.responseType === 'arraybuffer') {
      return response
    }

    const timestamp = response.headers[`wechatpay-timestamp`]
    const nonce = response.headers[`wechatpay-nonce`]
    const serial = response.headers[`wechatpay-serial`]
    const signature = response.headers[`wechatpay-signature`]
    // @see https://github.com/TheNorthMemory/wechatpay-axios-plugin/issues/8
    // The `204` statusCode means no content, here won't need JSON.stringify for `verify`
    const payload = 204 === response.status ? response.data : JSON.stringify(response.data)

    const localTimestamp = fmt.timestamp()
    assert.ok(
      // here's only allowed with negative and positive 5 minutes
      Math.abs(localTimestamp - timestamp) < 300,
      `The response was on ${timestamp}, your local is ${localTimestamp}. `
      + `Here's only allowed with negative and positive 5 minutes. `
      + `Please keeping your machine's datetime synchronized.`
    )

    assert.ok(
      // @see {rsa.verify} verify the response by the wechatpay public certificate
      rsa.verify(fmt.response(timestamp, nonce, payload), signature, certs[serial]),
      'Verify the response with '
      + `timestamp=${timestamp}, nonce=${nonce}, `
      + `signature=${signature}, cert={${serial}: publicCert} failed.`
    )

    return response
  })

  return axios
}

module.exports = interceptor
module.exports.default = interceptor
