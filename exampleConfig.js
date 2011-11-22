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

*/
{
  graphitePort: 2003
, graphiteHost: "localhost"
, port: 8125
, amqp: true
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
}
