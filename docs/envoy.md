# Envoy Proxy Configuration

This guide covers deploying the Pi RPC HTTP Server behind an Envoy proxy with TLS termination.

## Overview

Envoy acts as a reverse proxy in front of the Pi RPC HTTP Server, providing:
- TLS termination
- Rate limiting
- Load balancing
- Circuit breaking
- Access logging

## Basic Configuration

### Envoy YAML Configuration

Save as `envoy.yaml`:

```yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8443
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
                route_config:
                  name: local_route
                  virtual_hosts:
                    - name: local_service
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: pi_rpc_cluster
                            timeout: 300s
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    - name: pi_rpc_cluster
      type: STATIC
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: pi_rpc_cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: 127.0.0.1
                      port_value: 3000
```

### Run Envoy

```bash
# With Docker
docker run -d -p 8443:8443 \
  -v $(pwd)/envoy.yaml:/etc/envoy/envoy.yaml \
  envoyproxy/envoy:v1.25-latest

# Or directly
envoy -c envoy.yaml
```

---

## TLS Termination

### Server Certificate Only

```yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8443
      filter_chains:
        - tls_context:
            common_tls_context:
              tls_certificates:
                - certificate_chain:
                    filename: /etc/envoy/certs/server.crt
                  private_key:
                    filename: /etc/envoy/certs/server.key
          filters:
            - name: envoy.filters.network.http_connection_manager
              # ... rest of config
```

### With CA Certificate (Mutual TLS)

```yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8443
      filter_chains:
        - tls_context:
            common_tls_context:
              tls_certificates:
                - certificate_chain:
                    filename: /etc/envoy/certs/server.crt
                  private_key:
                    filename: /etc/envoy/certs/server.key
              validation_context:
                trusted_ca:
                  filename: /etc/envoy/certs/ca.crt
                verify_subject_alt_name:
                  - "client.example.com"
          filters:
            - name: envoy.filters.network.http_connection_manager
              # ... rest of config
```

---

## Complete Configuration with TLS and mTLS

### Directory Structure

```
envoy/
├── envoy.yaml
├── certs/
│   ├── server.crt      # Server certificate
│   ├── server.key      # Server private key
│   ├── ca.crt          # CA certificate (for mTLS)
│   ├── client.crt      # Client certificate (for testing)
│   └── client.key      # Client private key
└── logs/
    └── access.log
```

### Full Envoy Configuration

```yaml
admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901

static_resources:
  listeners:
    - name: https_listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8443
      listener_filters:
        - name: envoy.filters.listener.tls_inspector
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector
      filter_chains:
        - filter_chain_match:
            # Optional: restrict to specific server names
            server_names: ["api.example.com"]
          tls_context:
            common_tls_context:
              tls_certificates:
                - certificate_chain:
                    filename: /etc/envoy/certs/server.crt
                  private_key:
                    filename: /etc/envoy/certs/server.key
              # Uncomment for mTLS (client certificate verification)
              # validation_context:
              #   trusted_ca:
              #     filename: /etc/envoy/certs/ca.crt
              #   verify_subject_alt_name:
              #     - "client.example.com"
              #   require_client_certificate: true
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: pi_rpc_ingress
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: /etc/envoy/logs/access.log
                route_config:
                  name: pi_rpc_route
                  virtual_hosts:
                    - name: pi_rpc_service
                      domains: ["*"]
                      cors:
                        allow_origin_string_match:
                          - prefix: "*"
                        allow_methods: GET,POST,DELETE,OPTIONS
                        allow_headers: content-type,authorization
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: pi_rpc_cluster
                            timeout: 300s
                            # Retry configuration
                            retry_policy:
                              retry_on: 5xx,reset,connect-failure
                              num_retries: 3
                              per_try_timeout: 30s
                http_filters:
                  - name: envoy.filters.http.ext_authz
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                      failure_mode_allow: false
                      transport_api_version: V3
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

    # Admin interface (HTTP)
    - name: admin_listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 9901
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: admin
                route_config:
                  name: admin_route
                  virtual_hosts:
                    - name: admin
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/"
                          direct_response:
                            status: 200

  clusters:
    - name: pi_rpc_cluster
      type: STATIC
      lb_policy: ROUND_ROBIN
      health_checks:
        - timeout: 2s
          interval: 10s
          unhealthy_threshold: 3
          healthy_threshold: 2
          http_health_check:
            path: "/health"
      circuit_breakers:
        thresholds:
          - max_connections: 100
            max_pending_requests: 100
            max_requests: 100
            max_retries: 3
      load_assignment:
        cluster_name: pi_rpc_cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: 127.0.0.1
                      port_value: 3000
```

---

## Generate Self-Signed Certificates

### CA Certificate

```bash
# Generate CA private key
openssl genrsa -out ca.key 4096

# Generate CA certificate
openssl req -x509 -new -nodes -key ca.key -sha256 -days 365 \
  -out ca.crt \
  -subj "/CN=Pi RPC CA"
```

### Server Certificate

```bash
# Generate server private key
openssl genrsa -out server.key 2048

# Generate server CSR
openssl req -new -key server.key \
  -out server.csr \
  -subj "/CN=api.example.com"

# Sign with CA
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt \
  -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:api.example.com")
```

### Client Certificate (for mTLS)

```bash
# Generate client private key
openssl genrsa -out client.key 2048

# Generate client CSR
openssl req -new -key client.key \
  -out client.csr \
  -subj "/CN=client.example.com"

# Sign with CA
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt \
  -days 365 -sha256
```

---

## Docker Compose with Envoy

```yaml
version: '3.8'

services:
  envoy:
    image: envoyproxy/envoy:v1.25-latest
    ports:
      - "8443:8443"
      - "9901:9901"
    volumes:
      - ./envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - ./envoy/certs:/etc/envoy/certs:ro
      - ./envoy/logs:/etc/envoy/logs
    environment:
      - ENVOY_UID=0
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9901/server_info"]
      interval: 30s
      timeout: 10s
      retries: 3

  pi-rpc-http:
    build: .
    environment:
      - PORT=3000
      - LOG_LEVEL=info
    expose:
      - "3000"
    restart: unless-stopped

networks:
  default:
    name: pi-rpc-network
```

---

## Testing

### Test with curl (Server TLS only)

```bash
curl -k https://localhost:8443/clients
```

### Test with curl (Mutual TLS)

```bash
curl --cert client.crt --key client.key \
  -k https://localhost:8443/clients
```

### Verify Certificate Chain

```bash
# Check server certificate
openssl s_client -connect localhost:8443 -servername api.example.com

# Full verification with CA
openssl s_client -connect localhost:8443 \
  -CAfile ca.crt -servername api.example.com
```

---

## Rate Limiting (Optional)

Add rate limiting to the configuration:

```yaml
http_filters:
  - name: envoy.filters.local_ratelimit
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
      stat_prefix: http_local_rate_limiter
      token_bucket:
        max_tokens: 10000
        tokens_per_interval: 1000
        interval: 1s
      filter_enabled:
        runtime_key: local_rate_limit_enabled
        default_value:
          numerator: 100
          denominator: HUNDRED
```

---

## Monitoring

### Prometheus Metrics

```yaml
# Add to admin section
metrics_service:
  grpc_service:
    envoy_grpc:
      cluster_name: prometheus
```

### Access Logging

Access logs are written to `/etc/envoy/logs/access.log` by default.

Format:
```
[2024-01-15T10:30:00.000Z] "GET /clients HTTP/1.1" 200 - "-" "curl/7.68.0"
```

---

## Security Best Practices

1. **Use valid certificates** - Replace self-signed certs in production
2. **Restrict admin access** - Bind admin listener to localhost only
3. **Enable mTLS** - Require client certificates for sensitive endpoints
4. **Keep Envoy updated** - Use latest stable version
5. **Monitor logs** - Set up alerting for errors
6. **Use TLS 1.3** - Configure minimum TLS version