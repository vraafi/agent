import json
import os

def generate_iac():
    # 1. JSON Configuration of 5 microservices
    config_json = """
    [
        {"name": "auth-service", "port": 8081, "dependencies": []},
        {"name": "user-service", "port": 8082, "dependencies": ["auth-service"]},
        {"name": "order-service", "port": 8083, "dependencies": ["user-service", "auth-service"]},
        {"name": "payment-service", "port": 8084, "dependencies": ["order-service"]},
        {"name": "notification-service", "port": 8085, "dependencies": ["payment-service"]}
    ]
    """
    services = json.loads(config_json)
    output_dir = "generated_iac"
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # Templates
    dockerfile_template = """FROM python:3.9-slim
WORKDIR /app
COPY . /app
RUN pip install -r requirements.txt
EXPOSE {port}
CMD ["python", "main.py"]
"""

    deployment_template = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  labels:
    app: {name}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: {name}
  template:
    metadata:
      labels:
        app: {name}
    spec:
      containers:
      - name: {name}
        image: {name}:latest
        ports:
        - containerPort: {port}
        env:
{env_vars}
"""

    service_template = """apiVersion: v1
kind: Service
metadata:
  name: {name}
spec:
  selector:
    app: {name}
  ports:
    - protocol: TCP
      port: 80
      targetPort: {port}
  type: ClusterIP
"""

    rabbitmq_deployment = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rabbitmq
  template:
    metadata:
      labels:
        app: rabbitmq
    spec:
      containers:
      - name: rabbitmq
        image: rabbitmq:3-management
        ports:
        - containerPort: 5672
        - containerPort: 15672
---
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
spec:
  selector:
    app: rabbitmq
  ports:
    - name: amqp
      port: 5672
      targetPort: 5672
    - name: management
      port: 15672
      targetPort: 15672
  type: ClusterIP
"""

    # Generate files for each microservice
    for svc in services:
        name = svc['name']
        port = svc['port']
        deps = svc['dependencies']
        
        # Create service directory
        svc_dir = os.path.join(output_dir, name)
        if not os.path.exists(svc_dir):
            os.makedirs(svc_dir)

        # Generate Dockerfile
        with open(os.path.join(svc_dir, "Dockerfile"), "w") as f:
            f.write(dockerfile_template.format(port=port))

        # Generate K8s Deployment
        env_vars = ""
        for dep in deps:
            env_vars += f"        - name: {dep.upper().replace('-', '_')}_HOST\n          value: {dep}\n"
        # Add RabbitMQ as a default dependency for all services to simulate the message queue
        env_vars += f"        - name: RABBITMQ_HOST\n          value: rabbitmq\n"
        
        with open(os.path.join(svc_dir, "deployment.yaml"), "w") as f:
            f.write(deployment_template.format(name=name, port=port, env_vars=env_vars))

        # Generate K8s Service
        with open(os.path.join(svc_dir, "service.yaml"), "w") as f:
            f.write(service_template.format(name=name, port=port))

    # Generate RabbitMQ manifests
    with open(os.path.join(output_dir, "rabbitmq.yaml"), "w") as f:
        f.write(rabbitmq_deployment)

    print(f"Successfully generated IaC manifests in directory: {output_dir}")

if __name__ == "__main__":
    generate_iac()
