const SUBSCRIPTIONS = 'reminder_subscriptions'
const DELIVERIES = 'reminder_deliveries'
const PROGRESS = 'card_progress'

function withoutId(record) {
  const { _id, ...data } = record
  return data
}

function createCloudRepository(database) {
  const read = async (scope, collection, id) => {
    const result = await scope.collection(collection).doc(id).get()
    return result.data || null
  }
  const transactionView = scope => ({
    getSubscription: id => read(scope, SUBSCRIPTIONS, id),
    putSubscription: (id, record) => scope.collection(SUBSCRIPTIONS).doc(id).set({ data: withoutId(record) }),
    getDelivery: id => read(scope, DELIVERIES, id),
    putDelivery: (id, record) => scope.collection(DELIVERIES).doc(id).set({ data: withoutId(record) }),
    getProgress: id => read(scope, PROGRESS, id),
    putProgress: (id, record) => scope.collection(PROGRESS).doc(id).set({ data: withoutId(record) }),
  })
  return {
    getSubscription: id => read(database, SUBSCRIPTIONS, id),
    getProgress: id => read(database, PROGRESS, id),
    transaction: callback => database.runTransaction(async transaction => callback(transactionView(transaction))),
    async listDue({ dueAt, after, limit }) {
      const command = database.command
      const filters = [{ status: 'active', nextSendAt: command.lte(dueAt) }]
      if (after) {
        filters.push(command.or([
          { nextSendAt: command.gt(after.nextSendAt) },
          { nextSendAt: command.eq(after.nextSendAt), _id: command.gt(after.id) },
        ]))
      }
      const result = await database.collection(SUBSCRIPTIONS)
        .where(command.and(filters))
        .orderBy('nextSendAt', 'asc')
        .orderBy('_id', 'asc')
        .field({ _id: true, nextSendAt: true })
        .limit(limit)
        .get()
      return result.data.map(record => ({ id: record._id, nextSendAt: record.nextSendAt }))
    },
  }
}

function createWeChatProvider(cloud) {
  return {
    send: message => cloud.openapi.subscribeMessage.send(message),
  }
}

module.exports = { createCloudRepository, createWeChatProvider }
