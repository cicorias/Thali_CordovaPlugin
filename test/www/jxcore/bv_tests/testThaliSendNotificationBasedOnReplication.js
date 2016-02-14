'use strict';

var tape = require('../lib/thali-tape');
var getRandomlyNamedTestPouchDBInstance =
  require('../lib/testUtils.js').getRandomlyNamedTestPouchDBInstance;
var ThaliNotificationServer =
  require('thali/NextGeneration/notification/thaliNotificationServer');
var proxyquire = require('proxyquire');
var sinon = require('sinon');
var express = require('express');
var crypto = require('crypto');
var Promise = require('lie');
var ThaliSendNotificationBasedOnReplication =
  require('thali/NextGeneration/replication/thaliSendNotificationBasedOnReplication');
var urlsafeBase64 = require('urlsafe-base64');

var test = tape({
  setup: function (t) {
    t.end();
  },
  teardown: function (t) {
    t.end();
  }
});

/**
 * This function will be passed in the PouchDB object being used in the test
 * so that it can set it up.
 *
 * @public
 * @callback pouchDbInitFunction
 * @param {Object} pouchDB
 * @returns {Promise<?Error>}
 */

/**
 * This callback is used to let the test set up the mock, put documents in
 * the DB, check the constructor functions, etc. The values below that start
 * with 'submitted' are the ones that were generated by the test rig and
 * used to create the thaliSendNotificationServer instance. The values that
 * start with used are the values that were passed on by the
 * thaliSendNotificationServer code when calling the ThaliNotificationServer
 * object.
 *
 * @public
 * @callback mockInitFunction
 * @param {Object} mock
 */

var DEFAULT_MILLISECONDS_UNTIL_EXPIRE = 100;

/**
 *
 * @callback runTestFunction
 * @param {Object} thaliSendNotificationBasedOnReplication
 * @param {Object} pouchDB
 */

/**
 * Creates the environment, and runs the init functions in order and then
 * validates that the mock is good and that the constructor for the
 * notification server ran correctly.
 * @param {Object} t The tape status reporting object
 * @param {pouchDbInitFunction} pouchDbInitFunction
 * @param {mockInitFunction} mockInitFunction
 * @param {runTestFunction} runTestFunction
 */
function testScaffold(t, pouchDbInitFunction, mockInitFunction,
                      runTestFunction) {
  var router = express.Router();
  var ecdhForLocalDevice = crypto.createECDH('secp521r1').generateKeys();
  var millisecondsUntilExpiration = DEFAULT_MILLISECONDS_UNTIL_EXPIRE;
  var pouchDB = getRandomlyNamedTestPouchDBInstance();

  var SpyOnThaliNotificationServerConstructor =
    sinon.spy(ThaliNotificationServer);

  var mockThaliNotificationServer = null;

  pouchDbInitFunction(pouchDB)
    .then(function () {
      var MockThaliNotificationServer =
        function (router, ecdhForLocalDevice, millisecondsUntilExpiration) {
          var spyServer = new SpyOnThaliNotificationServerConstructor(router,
            ecdhForLocalDevice, millisecondsUntilExpiration);
          mockThaliNotificationServer = sinon.mock(spyServer);
          mockInitFunction(mockThaliNotificationServer);
          return spyServer;
        };

      var ThaliSendNotificationBasedOnReplicationProxyquired =
        proxyquire(
          'thali/NextGeneration/replication/' +
          'thaliSendNotificationBasedOnReplication',
          { '../notification/thaliNotificationServer':
          MockThaliNotificationServer});

      var thaliSendNotificationBasedOnReplication =
        new ThaliSendNotificationBasedOnReplicationProxyquired(router,
          ecdhForLocalDevice, millisecondsUntilExpiration, pouchDB);

      runTestFunction(thaliSendNotificationBasedOnReplication, pouchDB)
        .then(function () {
          mockThaliNotificationServer.verify();
          t.ok(SpyOnThaliNotificationServerConstructor.calledOnce);
          t.ok(SpyOnThaliNotificationServerConstructor
            .calledWithExactly(router, ecdhForLocalDevice,
              millisecondsUntilExpiration));
          t.end();
        });
    });
}

/**
 * @public
 * @typedef {?Buffer[]} startArg This is the value to use in the call to start
 * on the thaliSendNotificationBasedOnReplication object.
 */

/**
 * Lets us do some work after the start and before the stop.
 *
 * @public
 * @callback betweenStartAndStopFunction
 * @param {Object} pouchDB
 * @returns {Promise<?Error>}
 */

// jscs:disable jsDoc
/**
 * Calls start, lets some user code set things up and then calls finish. The
 * ThaliNotificationServer object is fully mocked and so has to be configured
 * using the mockInitFunction.
 *
 * @param {Object} t The tape status reporting object
 * @param {startArg} startArg
 * @param {pouchDbInitFunction} pouchDbInitFunction
 * @param {mockInitFunction} mockInitFunction
 * @param {betweenStartAndStopFunction} [betweenStartAndStopFunction]
 */
// jscs:enable jsDoc
function testStartAndStop(t, startArg, pouchDbInitFunction, mockInitFunction,
                          betweenStartAndStopFunction) {
  testScaffold(t, pouchDbInitFunction, mockInitFunction,
    function (thaliSendNotificationBasedOnReplication, pouchDB) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          if (betweenStartAndStopFunction) {
            return betweenStartAndStopFunction(pouchDB);
          }
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
}

function mockStartAndStop(mockThaliNotificationServer, startArg) {
  mockThaliNotificationServer.expects('start')
    .once()
    .withExactArgs(startArg)
    .returns(Promise.resolve());

  mockThaliNotificationServer.expects('stop')
    .once()
    .withExactArgs()
    .returns(Promise.resolve());
}

test('No peers and empty database', function (t) {
  var startArg = [];
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer, []);
    });
});

test('One peer and empty DB', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer, []);
    });
});

test('One peer with _Local set behind current seq', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
                   .calculateSeqPointKeyId(partnerPublicKey),
             lastSyncedSequenceNumber: 0});
        });
    },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer, startArg);
    });
});

test('One peer with _Local set equal to current seq', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
              lastSyncedSequenceNumber: 2});
        });
    },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer, []);
    });
});

test('One peer with _Local set ahead of current seq (and no this should ' +
     'not happen)', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
              lastSyncedSequenceNumber: 50});
        });
    },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer, []);
    });
});

test('Three peers, one not in DB, one behind and one ahead', function (t) {
  var partnerNotInDbPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var partnerBehindInDbPublicKey =
    crypto.createECDH('secp521r1').generateKeys();
  var partnerAheadInDbPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerNotInDbPublicKey, partnerBehindInDbPublicKey,
                  partnerAheadInDbPublicKey];
  testStartAndStop(
    t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({_id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {
              _id: ThaliSendNotificationBasedOnReplication
                .calculateSeqPointKeyId(partnerBehindInDbPublicKey),
              lastSyncedSequenceNumber: 1
            }
        );})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerAheadInDbPublicKey),
            lastSyncedSequenceNumber: 500}
          );
        });
    },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer,
                       [ partnerNotInDbPublicKey, partnerBehindInDbPublicKey]);
    });
});

test('More than maximum peers, make sure we only send maximum allowed',
  function (t) {
    var startArg = [];
    for (var i = 0;
        i < ThaliSendNotificationBasedOnReplication
            .MAXIMUM_NUMBER_OF_PEERS_TO_NOTIFY + 10;
        ++i) {
      startArg.push(crypto.createECDH('secp521r1').generateKeys());
    }
    testStartAndStop(
      t,
      startArg,
    function (pouchDB) {
      return pouchDB.put({_id: 'ick', stuff: 23});
    },
    function (mockThaliNotificationServer) {
      mockStartAndStop(mockThaliNotificationServer,
                        startArg.slice(0,
                          ThaliSendNotificationBasedOnReplication
                            .MAXIMUM_NUMBER_OF_PEERS_TO_NOTIFY));
    });
  });

test('two peers with empty DB, update the doc', function (t) {
  var partnerOnePublicKey = crypto.createECDH('secp521r1').generateKeys();
  var partnerTwoPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerOnePublicKey, partnerTwoPublicKey];
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs([]).returns(Promise.resolve());
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function (pouchDB) {
      return new Promise(function (resolve, reject) {
        pouchDB.put({_id: '33', stuff: 'uhuh'})
          .then(function () {
            setTimeout(function () {
              resolve();
            }, 10);
          }).catch(function (err) {
            reject(err);
          });
      });
    });
});

test('add doc and make sure tokens refresh when they expire', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({_id: '45', stuff: 'yo'})
        .then(function () {
          return pouchDB.put({_id: '23', stuff: 'hey'});
        }).then(function () {
          return pouchDB.put({
            _id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
            lastSyncedSequenceNumber: 1});
        });
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .thrice().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve();
        }, DEFAULT_MILLISECONDS_UNTIL_EXPIRE * 2 + 10);
      });
    });
});

test('start and stop and start and stop', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'yikes!', stuff: 'huh'});
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .twice().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .twice().withExactArgs().returns(Promise.resolve());
    },
    function (thaliSendNotificationBasedOnReplication) {
      t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
        'start out null');
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
          'back to null');
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
            'still null');
        });
    });
});

test('two identical starts in a row', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('two different starts in a row', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs([]).returns(Promise.resolve());


      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.start([]);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('two stops and a start and two stops', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.stop()
        .then(function () {
          thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('we properly enqueue requests so no then needed', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer) {
      mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());
    },
    function (thaliSendNotificationBasedOnReplication) {
      var promiseArray = [
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.start(startArg),
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.stop()
        ];
      return Promise.all(promiseArray);
    });
});

test('test calculateSeqPointKeyId', function (t) {
  var publicKey = crypto.createECDH('secp521r1').generateKeys();
  var keyId = ThaliSendNotificationBasedOnReplication
    .calculateSeqPointKeyId(publicKey);
  var thaliPrefix = 'thali';
  t.equal(keyId.indexOf(thaliPrefix), 0);
  t.equal(urlsafeBase64.decode(keyId.substr(thaliPrefix.length))
    .compare(publicKey), 0);
  t.end();
});
