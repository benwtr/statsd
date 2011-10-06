var dgram  = require('dgram')
  , sys    = require('sys')
  , net    = require('net')
  , config = require('./config')

var counters = {};
var timers = {};
var debugInt, flushInt, server;
var amqpConnection = false;

config.configFile(process.argv[2], function (config, oldConfig) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt); 
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) { clearInterval(debugInt); }
    debugInt = setInterval(function () { 
      sys.log("Counters:\n" + sys.inspect(counters) + "\nTimers:\n" + sys.inspect(timers));
    }, config.debugInterval || 10000);
  }

  if (config.amqp && ! amqpConnection) {
    try {
      amqp = require('amqp')
      amqpConnection = amqp.createConnection(config.amqpOptions);
      amqpConnection.addListener('error', function(connectionException){
        if (config.debug) {
          sys.log(connectionException);
        }
      });
      amqpConnection.on('ready', function() {
        amqpExchange = amqpConnection.exchange(config.amqpExchange, { passive: 'true' }, function() {
          amqpExchangeIsReady = true;
        });
      });
    }
    catch(e) {
      if (config.debug) {
        sys.log(e);
      }
    }
  }

  if (server === undefined) {
    server = dgram.createSocket('udp4', function (msg, rinfo) {
      if (config.dumpMessages) { sys.log(msg.toString()); }
      var bits = msg.toString().split(':');
      var key = bits.shift()
                    .replace(/\s+/g, '_')
                    .replace(/\//g, '-')
                    .replace(/[^a-zA-Z_\-0-9\.]/g, '');

      if (bits.length == 0) {
        bits.push("1");
      }

      for (var i = 0; i < bits.length; i++) {
        var sampleRate = 1;
        var fields = bits[i].split("|");
        if (fields[1] === undefined) {
            sys.log('Bad line: ' + fields);
            continue;
        }
        if (fields[1].trim() == "ms") {
          if (! timers[key]) {
            timers[key] = [];
          }
          timers[key].push(Number(fields[0] || 0));
        } else {
          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
          }
          if (! counters[key]) {
            counters[key] = 0;
          }
          counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
        }
      }
    });

    server.bind(config.port || 8125);

    var flushInterval = Number(config.flushInterval || 10000);

    flushInt = setInterval(function () {
      var statString = '';
      var ts = Math.round(new Date().getTime() / 1000);
      var numStats = 0;
      var key;

      for (key in counters) {
        var value = counters[key] / (flushInterval / 1000);
        var message = config.rocksteadyRetention + '.statsd.stats.' + key + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + value + ' ' + ts + "\n";
        message += config.rocksteadyRetention + '.statsd.stats_counts.' + key + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + counters[key] + ' ' + ts + "\n";
        statString += message;
        counters[key] = 0;

        numStats += 1;
      }

      for (key in timers) {
        if (timers[key].length > 0) {
          var pctThreshold = config.percentThreshold || 90;
          var values = timers[key].sort(function (a,b) { return a-b; });
          var count = values.length;
          var min = values[0];
          var max = values[count - 1];

          var mean = min;
          var maxAtThreshold = max;

          // calculate median
          if (values.length%2 == 0) {
            var median = ( values.sort()[values.length/2] + values.sort()[(values.length/2)-1] ) / 2
          } else {
            var median = values.sort()[(values.length-1)/2];
          }

          if (count > 1) {
            var thresholdIndex = Math.round(((100 - pctThreshold) / 100) * count);
            var numInThreshold = count - thresholdIndex;
            values = values.slice(0, numInThreshold);
            maxAtThreshold = values[numInThreshold - 1];

            // average the remaining timings
            var sum = 0;
            for (var i = 0; i < numInThreshold; i++) {
              sum += values[i];
            }

            mean = sum / numInThreshold;
          }

          timers[key] = [];

          var message = "";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.mean ' + mean + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + ts + "\n";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.upper ' + max + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + ts + "\n";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.upper_' + pctThreshold + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + maxAtThreshold + ' ' + ts + "\n";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.lower ' + min + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + ts + "\n";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.median ' + median + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + ts + "\n";
          message += config.rocksteadyRetention + '.statsd.stats.timers.' + key + '.count ' + count + '.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + ts + "\n";
          statString += message;

          numStats += 1;
        }
      }

      statString += config.rocksteadyRetention + '.statsd.statsd.numStats.' + config.rocksteadyColo + '.' + config.rocksteadyHostname + ' ' + numStats + ' ' + ts + "\n";
      
      try {
        if (! config.amqp) {
          var graphite = net.createConnection(config.graphitePort, config.graphiteHost);
          graphite.addListener('error', function(connectionException){
            if (config.debug) {
              sys.log(connectionException);
            }
          });
          graphite.on('connect', function() {
            this.write(statString);
            this.end();
          });
        } else if (amqpExchangeIsReady) {
          if (config.amqpMetricNameInBody) {
            amqpExchange.publish('', statString);
          } else {
            var statsArray = statString.split("\n");
            for (var i = 0; i < statsArray.length; i++) {
              s = statsArray[i].split(" ");
              amqpExchange.publish(s[0], s[1] + " " + s[2] + "\n");
            }
          }
        } 
      } catch(e){
        if (config.debug) {
          sys.log(e);
        }
      }

    }, flushInterval);
  }

});

