/*

Required Variables:

  graphiteHost:     hostname or IP of Graphite server
  graphitePort:     port of Graphite server
  port:             StatsD listening port [default: 8125]

AMQP Variables:
  amqp:             enable AMQP (graphitePort and graphiteHost not required)
  amqpExchange:     AMQP exchange
  amqpOptions:      options for connecting to AMQP server
  amqpMetricNameInBody: deliver to graphite as a batch of metrics in a single
                    message (true), or as individual messages with the metric
                    name as the routing key (false)

Optional Variables:

  debug:            debug flag [default: false]
  debugInterval:    interval to print debug information [ms, default: 10000]
  dumpMessages:     log all incoming messages
  flushInterval:    interval (in ms) to flush to Graphite
  percentThreshold: for time information, calculate the Nth percentile
                    [%, default: 90]
  delayIntervals:   number of flush intervals to wait for delayed stats.
  address:          ip address to bind to
  mgmt_address:     ip address to bind to for mgmt server
  mgmt_port:        port for tcp mgmt server, default 8126

*/
{
  graphitePort: 2003
, graphiteHost: "localhost"
, port: 8125
, amqp: false
, amqpExchange: "graphite"
, amqpMetricNameInBody: true
, amqpOptions: {
    host: "localhost"
  , port: 5672
  , login: "guest"
  , password: "guest"
  , vhost: '/'
  }
, debug: false
, mgmt_port: 8126
, delayIntervals: 30
, dumpMessages: false
}
