{
  graphitePort: 2003
, graphiteHost: "localhost"
, port: 8125
, rocksteadyRetention: "10sec"
, rocksteadyColo: "hc"
, rocksteadyHostname: "stats"
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

