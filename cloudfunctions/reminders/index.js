const cloud = require('wx-server-sdk')
const { createCloudRepository, createWeChatProvider } = require('./cloud')
const { readConfiguration } = require('./configuration')
const { createReminderService } = require('./service')

// Current wx-server-sdk forwards retries/timeout to its CloudBase transport.
// Never enable automatic transport retries for this non-idempotent OpenAPI send.
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, retries: 0, timeout: 10_000 })
const repository = createCloudRepository(cloud.database({ throwOnNotFound: false }))
const provider = createWeChatProvider(cloud)

exports.main = async event => {
  const service = createReminderService({ repository, provider, configuration: readConfiguration(process.env) })
  // getWXContext must be read within this invocation, never from client JSON or
  // the untrusted event's OPENID/SOURCE/Type fields.
  return service.handle(event, cloud.getWXContext())
}
