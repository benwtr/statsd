var dgram  = require('dgram')
  , sys    = require('util')
  , net    = require('net')
  , config = require('./config')

var counters = {};
var timers = {};
var gauges = {};
var dtimers = [];
var debugInt, flushInt, server, mgmtServer;
var startup_time = Math.round(new Date().getTime() / 1000);
var amqpConnection = false;

var stats = {
  graphite: {
    last_flush: startup_time,
    last_exception: startup_time
  },
  messages: {
    last_msg_seen: startup_time,
    bad_lines_seen: 0,
  }
};

config.configFile(process.argv[2], function (config, oldConfig) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt);
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) { clearInterval(debugInt); }
    debugInt = setInterval(function () { 
      sys.log("Counters:\n" + sys.inspect(counters) + "\nTimers:\n" + sys.inspect(timers) + "\nDelayed Timers:\n" + sys.inspect(dtimers) + "\nGauges:\n" + sys.inspect(gauges));
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

  for (var i = 0; i < (config.delayIntervals || 30); i++) {
    dtimers[i] = new Array();
  }

  var flushInterval = Number(config.flushInterval || 10000);

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
            stats['messages']['bad_lines_seen']++;
            continue;
        }
        if (fields[1].trim() == "ms") {
          // delayed timers
          if (fields[2] && fields[2].match(/^t\d+/)) {
            var timestamp = fields[2].match(/^t(\d+)/)[1].trim();
            var timeNow = Math.round(new Date().getTime() / 1000);
            var interval = flushInterval / 1000;
            var pos = Number(Math.round((timeNow - timestamp) / interval) - 1);
            if (timestamp >= (timeNow - (interval * (config.delayIntervals || 30)))) {
              if (dtimers[pos][key] === undefined) {
                dtimers[pos][key] = new Array();
              }
              dtimers[pos][key].push(Number(fields[0] || 0));
              if (config.debug) {
                sys.log("adding to dtimer["+pos+"]"+"["+key+"]: "+ Number(fields[0] || 0));
              }
            }
          } else {
            if (! timers[key]) {
              timers[key] = [];
            }
            timers[key].push(Number(fields[0] || 0));
          }
        } else if (fields[1].trim() == "g") {
          gauges[key] = Number(fields[0] || 0);
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

      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
    });

    mgmtServer = net.createServer(function(stream) {
      stream.setEncoding('ascii');

      stream.on('data', function(data) {
        var cmd = data.trim();

        switch(cmd) {
          case "help":
            stream.write("Commands: stats, counters, timers, dtimers, quit\n\n");
            break;

          case "stats":
            var now    = Math.round(new Date().getTime() / 1000);
            var uptime = now - startup_time;

            stream.write("uptime: " + uptime + "\n");

            for (group in stats) {
              for (metric in stats[group]) {
                var val;

                if (metric.match("^last_")) {
                  val = now - stats[group][metric];
                }
                else {
                  val = stats[group][metric];
                }

                stream.write(group + "." + metric + ": " + val + "\n");
              }
            }
            stream.write("END\n\n");
            break;

          case "counters":
            stream.write(sys.inspect(counters) + "\n");
            stream.write("END\n\n");
            break;

          case "timers":
            stream.write(sys.inspect(timers) + "\n");
            stream.write("END\n\n");
            break;

          case "dtimers":
            stream.write(sys.inspect(dtimers) + "\n");
            stream.write("END\n\n");
            break;

          case "quit":
            stream.end();
            break;

          default:
            stream.write("ERROR\n");
            break;
        }

      });
    });

    server.bind(config.port || 8125, config.address || undefined);
    mgmtServer.listen(config.mgmt_port || 8126, config.mgmt_address || undefined);

    flushInt = setInterval(function () {
      var statString = '';
      var ts = Math.round(new Date().getTime() / 1000);
      var numStats = 0;
      var key;

      for (key in counters) {
        var value = counters[key] / (flushInterval / 1000);
        var message = 'stats.' + key + ' ' + value + ' ' + ts + "\n";
        message += 'stats_counts.' + key + ' ' + counters[key] + ' ' + ts + "\n";
        statString += message;
        counters[key] = 0;

        numStats += 1;
      }

      for (key in gauges) {
        statString += ('stats.' + key + ' ' + gauges[key] + ' ' + ts + "\n");
        numStats += 1;
      }
      gauges = {};

      dtimers.push(new Array());
      var dtimers_now = dtimers.shift();
      for (key in dtimers_now) {
        if (! timers[key]) {
          timers[key] = [];
        }
        timers[key] = timers[key].concat(dtimers_now[key]);
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
            var median = (values.sort()[values.length/2] + values.sort()[(values.length/2)-1]) / 2
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
          message += 'stats.timers.' + key + '.mean ' + mean + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.upper ' + max + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.upper_' + pctThreshold + ' ' + maxAtThreshold + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.lower ' + min + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.median ' + median + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.count ' + count + ' ' + ts + "\n";
          statString += message;

          numStats += 1;
        }
      }

      statString += 'statsd.numStats ' + numStats + ' ' + ts + "\n";
      
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
            stats['graphite']['last_flush'] = Math.round(new Date().getTime() / 1000);
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
          stats['graphite']['last_flush'] = Math.round(new Date().getTime() / 1000);
        } 
      } catch(e){
        if (config.debug) {
          sys.log(e);
        }
        stats['graphite']['last_exception'] = Math.round(new Date().getTime() / 1000);
      }

    }, flushInterval);
  }

});

