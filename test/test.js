const DocumentStore = require('../lib/documentStore')
const Provider = require('../lib/provider')
const path = require('path')
const Promise = require('bluebird')
const fs = require('fs')
const ncpAsync = Promise.promisify(require('ncp').ncp)
const sinon = require('sinon')
Promise.promisifyAll(fs)
const rimrafAsync = Promise.promisify(require('rimraf'))
require('should')
require('should-sinon')

function createDefaultStore () {
  const store = DocumentStore({
    logger: {
      info: () => { },
      error: () => { },
      warn: () => { },
      debug: () => { }
    }
  })

  store.registerComplexType('PhantomType', {
    margin: { type: 'Edm.String' },
    header: { type: 'Edm.String', document: { extension: 'html', engine: true } }
  })
  store.registerEntityType('TemplateType', {
    _id: { type: 'Edm.String', key: true },
    name: { type: 'Edm.String', publicKey: true },
    content: { type: 'Edm.String', document: { extension: 'html', engine: true } },
    recipe: { type: 'Edm.String' },
    modificationDate: { type: 'Edm.DateTimeOffset' },
    phantom: { type: 'jsreport.PhantomType' }
  })
  store.registerEntitySet('templates', { entityType: 'jsreport.TemplateType', splitIntoDirectories: true })

  store.registerEntityType('AssetType', {
    _id: { type: 'Edm.String', key: true },
    name: { type: 'Edm.String', publicKey: true },
    content: { type: 'Edm.Binary', document: { extension: 'html', content: true } }
  })
  store.registerEntitySet('assets', { entityType: 'jsreport.AssetType', splitIntoDirectories: true })

  store.registerEntityType('SettingsType', {
    _id: { type: 'Edm.String', key: true },
    key: { type: 'Edm.String' },
    value: { type: 'Edm.String' }
  })
  store.registerEntitySet('settings', { entityType: 'jsreport.SettingsType' })

  return store
}

describe('provider', () => {
  let store
  const tmpData = path.join(__dirname, 'tmpData')
  let resolveFileExtension

  beforeEach(async () => {
    resolveFileExtension = () => null
    await rimrafAsync(tmpData)

    store = createDefaultStore()
    store.registerProvider(Provider({ dataDirectory: tmpData, logger: store.options.logger }))
    store.addFileExtensionResolver(() => resolveFileExtension())
    await store.init()
  })

  afterEach(() => {
    store.provider.sync.stop()
    return rimrafAsync(tmpData)
  })

  describe('basic', () => {
    it('insert and query', async () => {
      await store.collection('templates').insert({ name: 'test' })
      const res = await store.collection('templates').find({ name: 'test' })
      res.length.should.be.eql(1)
    })

    it('insert and query with condition', async () => {
      await store.collection('templates').insert({ name: 'test' })
      const res = await store.collection('templates').find({ name: 'diferent' })
      res.length.should.be.eql(0)
    })

    it('insert, update, query', async () => {
      await store.collection('templates').insert({ name: 'test' })
      await store.collection('templates').update({ name: 'test' }, { $set: { recipe: 'foo' } })
      const res = await store.collection('templates').find({ name: 'test' })
      res.length.should.be.eql(1)
      res[0].recipe.should.be.eql('foo')
    })

    it('insert remove query', async () => {
      await store.collection('templates').insert({ name: 'test' })
      await store.collection('templates').remove({ name: 'test' })
      const res = await store.collection('templates').find({ name: 'test' })
      res.length.should.be.eql(0)
    })

    it('remove should delete doc folder', async () => {
      await store.collection('templates').insert({ name: 'test' })
      fs.existsSync(path.join(tmpData, 'templates', 'test')).should.be.true()
      await store.collection('templates').remove({ name: 'test' })
      fs.existsSync(path.join(tmpData, 'templates', 'test')).should.be.false()
    })

    it('insert should return an object with _id set', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      doc.should.have.property('_id')
      doc._id.should.be.ok()
    })

    it('insert, update to a different name', async () => {
      await store.collection('templates').insert({ name: 'test' })
      await store.collection('templates').update({ name: 'test' }, { $set: { name: 'test2' } })
      const res = await store.collection('templates').find({ name: 'test2' })
      res.length.should.be.eql(1)
    })

    it('update with upsert', async () => {
      await store.collection('templates').update({ name: 'test' }, { $set: { name: 'test2' } }, { upsert: true })
      const res = await store.collection('templates').find({ name: 'test2' })
      res.length.should.be.eql(1)
    })

    it('find should return clones', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'original' })
      const res = await store.collection('templates').find({})
      res[0].content = 'modified'
      const res2 = await store.collection('templates').find({})
      res2[0].content.should.be.eql('original')
    })

    it('insert should use clones', async () => {
      const doc = { name: 'test', content: 'original' }
      await store.collection('templates').insert(doc)
      doc.content = 'modified'
      const res = await store.collection('templates').find({})
      res[0].content.should.be.eql('original')
    })
  })

  describe('document properties', () => {
    it('should be persisted into dedicated files', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      const content = (await fs.readFileAsync(path.join(tmpData, 'templates', 'test', 'content.html'))).toString()
      content.should.be.eql('foo')
    })

    it('should be persisted with file extension gathered from resolveFileExtension', async () => {
      resolveFileExtension = () => 'txt'
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      const content = (await fs.readFileAsync(path.join(tmpData, 'templates', 'test', 'content.txt'))).toString()
      content.should.be.eql('foo')
    })
  })

  describe('validations', () => {
    it('insert doc with / in name should throw', async () => {
      try {
        await store.collection('templates').insert({ name: 'test/aaa' })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed') {
          throw e
        }
      }
    })

    it('update doc with / in name should throw', async () => {
      await store.collection('templates').insert({ name: 'test' })
      try {
        await store.collection('templates').update({ name: 'test' }, { $set: { name: 'test/test' } })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed') {
          throw e
        }
      }
    })

    it('insert duplicated key should throw and not be included in the query', async () => {
      await store.collection('templates').insert({ name: 'test' })
      try {
        await store.collection('templates').insert({ name: 'test' })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed' || !e.message.includes('Duplicate')) {
          throw e
        }
      }

      const res = await store.collection('templates').find({})
      res.should.have.length(1)
    })
  })

  describe('queries', () => {
    it('skip and limit', async () => {
      await store.collection('templates').insert({ name: '1' })
      await store.collection('templates').insert({ name: '3' })
      await store.collection('templates').insert({ name: '2' })

      const res = await store.collection('templates').find({}).skip(1).limit(1).sort({name: 1}).toArray()
      res.length.should.be.eql(1)
      res[0].name.should.be.eql('2')
    })

    it('$and', async () => {
      await store.collection('templates').insert({ name: '1', recipe: 'a' })
      await store.collection('templates').insert({ name: '2', recipe: 'b' })
      await store.collection('templates').insert({ name: '3', recipe: 'b' })

      const res = await store.collection('templates').find({$and: [{name: '2'}, {recipe: 'b'}]}).toArray()
      res.length.should.be.eql(1)
      res[0].name.should.be.eql('2')
      res[0].recipe.should.be.eql('b')
    })

    it('projection', async () => {
      await store.collection('templates').insert({ name: '1', recipe: 'a' })

      const res = await store.collection('templates').find({}, { recipe: 1 })
      res.length.should.be.eql(1)
      res[0].should.not.have.property('name')
      res[0].recipe.should.be.eql('a')
    })

    it('count', async () => {
      await store.collection('templates').insert({ name: '1', recipe: 'a' })

      const res = await store.collection('templates').find({}).count()
      res.should.be.eql(1)
    })

    it('count without cursor', async () => {
      await store.collection('templates').insert({ name: '1', recipe: 'a' })

      const res = await store.collection('templates').count({})
      res.should.be.eql(1)
    })
  })

  describe('files monitoring', () => {
    it('should fire reload event on file changes', async () => {
      await store.collection('templates').insert({ name: 'test', recipe: 'foo' })
      return new Promise((resolve) => {
        store.provider.sync.subscribe((e) => {
          e.action.should.be.eql('reload')
          resolve()
        })
        store.provider.sync.tresholdForSkippingOwnProcessWrites = 1
        fs.writeFileSync(path.join(tmpData, 'templates', 'test', 'config.json'), JSON.stringify({ $entitySet: 'templates', name: 'test', recipe: Date.now() }))
      })
    })

    it('should not fire reload event for recent changes', async () => {
      await store.collection('templates').insert({ name: 'test', recipe: 'foo' })

      let notified = false
      store.provider.sync.subscribe((e) => (notified = true))
      fs.writeFileSync(path.join(tmpData, 'templates', 'test', 'config.json'), JSON.stringify({ $entitySet: 'templates', name: 'test', recipe: Date.now() }))
      return Promise.delay(200).then(() => {
        notified.should.be.false()
      })
    })
  })

  describe('queueing', () => {
    // otherwise we get queuing called from the sync reload action
    beforeEach(() => store.provider.sync.stop())

    it('insert should go to queue', async () => {
      store.provider.queue = sinon.mock()
      await store.collection('templates').insert({ name: 'test' })
      store.provider.queue.should.be.called()
    })

    it('remove should go to queue', async () => {
      await store.collection('templates').insert({ name: 'test' })
      store.provider.queue = sinon.spy()
      await store.collection('templates').remove({ name: 'test' })
      store.provider.queue.should.be.called()
    })

    it('update should go to queue', async () => {
      await store.collection('templates').insert({ name: 'test' })
      store.provider.queue = sinon.spy()
      await store.collection('templates').update({ name: 'test' }, { $set: { recipe: 'foo' } })
      store.provider.queue.should.be.called()
    })

    it('find toArray should go to queue', async () => {
      await store.collection('templates').insert({ name: 'test' })
      store.provider.queue = sinon.spy()
      await store.collection('templates').find({ name: 'test' }).toArray()
      store.provider.queue.should.be.called()
    })
  })

  describe('syncing', () => {
    // stop default monitoring and use mocks instead
    beforeEach(() => store.provider.sync.stop())

    it('insert should publish event', async () => {
      store.provider.sync.publish = sinon.spy()
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'insert', doc: doc })
    })

    it('insert should publish refresh event if message big', async () => {
      store.provider.sync.publish = sinon.spy()
      store.provider.sync.messageSizeLimit = 1
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({
        action: 'refresh',
        doc: { _id: doc._id, $entitySet: 'templates', name: 'test' }
      })
    })

    it('update should publish event', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      await store.collection('templates').update({ name: 'test' }, { $set: { recipe: 'foo' } })
      doc.recipe = 'foo'
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'update', doc: doc })
    })

    it('insert should publish refresh event if message big', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      store.provider.sync.messageSizeLimit = 1
      await store.collection('templates').update({ name: 'test' }, { $set: { name: 'foo' } })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({
        action: 'refresh',
        doc: { _id: doc._id, $entitySet: 'templates', name: 'foo' }
      })
    })

    it('remove should publish event', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      await store.collection('templates').remove({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'remove', doc: doc })
    })

    it('subscribed insert event should insert doc', async () => {
      await store.provider.sync.subscription({
        action: 'insert',
        doc: { _id: 'a', name: 'foo', $entitySet: 'templates' }
      })
      const templates = await store.collection('templates').find({ _id: 'a' })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed update event should update doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      doc.name = 'foo'
      await store.provider.sync.subscription({
        action: 'update',
        doc: doc
      })
      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed remove event should remove doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      await store.provider.sync.subscription({
        action: 'remove',
        doc: doc
      })
      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(0)
    })

    it('subscribed refresh event should reload new doc', async () => {
      store.provider.persistence.reload = (doc) => doc

      await store.provider.sync.subscription({
        action: 'refresh',
        doc: { _id: 'a', name: 'foo', $entitySet: 'templates' }
      })

      const templates = await store.collection('templates').find({ _id: 'a' })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed refresh event should reload existing doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.persistence.reload = (d) => Object.assign({}, d, { name: 'foo' })

      await store.provider.sync.subscription({
        action: 'refresh',
        doc: doc
      })

      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })
  })

  describe('flat files', () => {
    it('insert should create flat file store', async () => {
      const doc = await store.collection('settings').insert({ key: 'a', value: '1' })
      fs.existsSync(path.join(tmpData, 'settings')).should.be.true()
      const readDoc = JSON.parse(fs.readFileSync(path.join(tmpData, 'settings')).toString())
      readDoc._id.should.be.eql(doc._id)
      readDoc.key.should.be.eql(doc.key)
      readDoc.value.should.be.eql(doc.value)
    })

    it('update should append to file new entry', async () => {
      await store.collection('settings').insert({ key: 'a', value: '1' })
      await store.collection('settings').update({ key: 'a' }, { $set: { value: '2' } })
      const docs = fs.readFileSync(path.join(tmpData, 'settings')).toString().split('\n').filter(c => c).map(JSON.parse)
      docs.should.have.length(2)
      docs[0].value.should.be.eql('1')
      docs[1].value.should.be.eql('2')
    })

    it('remove should append $$delete', async () => {
      await store.collection('settings').insert({ key: 'a', value: '1' })
      await store.collection('settings').remove({ key: 'a' })
      const docs = fs.readFileSync(path.join(tmpData, 'settings')).toString().split('\n').filter(c => c).map(JSON.parse)
      docs.should.have.length(2)
      docs[1].$$deleted.should.be.true()
    })
  })
})

describe('load', () => {
  let store

  beforeEach(async () => {
    store = createDefaultStore()
    store.registerProvider(Provider({ dataDirectory: path.join(__dirname, 'data'), logger: store.options.logger }))
    await store.init()
  })

  afterEach(() => {
    store.provider.sync.stop()
  })

  it('should load templates splitted into folder', async () => {
    const res = await store.collection('templates').find({})
    res.should.have.length(1)
    res[0].name.should.be.eql('Invoice')
    res[0].recipe.should.be.eql('phantom-pdf')
    res[0].content.should.be.eql('content')
    res[0].phantom.margin.should.be.eql('margin')
    res[0].phantom.header.should.be.eql('header')
    res[0].modificationDate.should.be.an.instanceOf(Date)
  })

  it('should load settings from flat file', async () => {
    const res = await store.collection('settings').find({}).sort({ key: 1 })
    res.should.have.length(2)
    res[0].key.should.be.eql('a')
    res[1].key.should.be.eql('b')
    res[0].value.should.be.eql('1')
  })

  it('should load assets binary content', async () => {
    const res = await store.collection('assets').find({})
    res.should.have.length(1)
    res[0].content.should.be.instanceof(Buffer)
  })
})

describe('load cleanup', () => {
  let store

  beforeEach(async () => {
    await rimrafAsync(path.join(__dirname, 'dataToCleanupCopy'))
    await ncpAsync(path.join(__dirname, 'dataToCleanup'), path.join(__dirname, 'dataToCleanupCopy'))
    store = createDefaultStore()
    store.registerProvider(Provider({ dataDirectory: path.join(__dirname, 'dataToCleanupCopy'), logger: store.options.logger }))
    await store.init()
  })

  afterEach(async () => {
    await rimrafAsync(path.join(__dirname, 'dataToCleanupCopy'))
    store.provider.sync.stop()
  })

  it('should load commited changes ~c~c', async () => {
    const res = await store.collection('templates').find({})
    res.should.have.length(1)
    res[0].name.should.be.eql('c')
    res[0].content.should.be.eql('changed')
  })

  it('should remove uncommited changes ~~a', () => {
    fs.existsSync(path.join(__dirname, 'dataToCleanupCopy', 'templates', '~~a')).should.be.false()
  })

  it('should remove commited and renamed changes', () => {
    fs.existsSync(path.join(__dirname, 'dataToCleanupCopy', 'templates', '~c~c')).should.be.false()
  })
})
