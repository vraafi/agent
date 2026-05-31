import asyncio
import random
import time
import logging
from enum import Enum
from collections import defaultdict

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] Node %(node_id)s: %(message)s'
)

class NodeState(Enum):
    FOLLOWER = 1
    CANDIDATE = 2
    LEADER = 3

class Message:
    def __init__(self, msg_id, content):
        self.msg_id = msg_id
        self.content = content

    def __repr__(self):
        return f"Msg({self.msg_id})"

class Node:
    def __init__(self, node_id, cluster):
        self.node_id = node_id
        self.cluster = cluster
        self.state = NodeState.FOLLOWER
        self.term = 0
        self.voted_for = None
        self.log = []  # List of (term, Message)
        self.commit_index = -1
        self.is_alive = True
        self.election_timeout = random.uniform(0.15, 0.3)
        self.last_heartbeat = time.time()
        self.logger = logging.LoggerAdapter(logging.getLogger(__name__), {'node_id': self.node_id})

    async def run(self):
        """Main loop for the node."""
        while True:
            if not self.is_alive:
                await asyncio.sleep(0.1)
                continue

            if self.state == NodeState.FOLLOWER:
                if time.time() - self.last_heartbeat > self.election_timeout:
                    await self.start_election()
            elif self.state == NodeState.CANDIDATE:
                if time.time() - self.last_heartbeat > self.election_timeout:
                    await self.start_election()
            elif self.state == NodeState.LEADER:
                await self.send_heartbeats()
                await asyncio.sleep(0.05) # Heartbeat interval

            await asyncio.sleep(0.01)

    async def start_election(self):
        self.state = NodeState.CANDIDATE
        self.term += 1
        self.voted_for = self.node_id
        self.last_heartbeat = time.time()
        self.logger.info(f"Starting election for term {self.term}")

        votes = 1 # Vote for self
        vote_requests = [self.cluster.send_vote_request(self.node_id, target_id, self.term) 
                         for target_id in self.cluster.node_ids if target_id != self.node_id]
        
        if vote_requests:
            results = await asyncio.gather(*vote_requests)
            votes += sum(1 for granted in results if granted)

        if votes > len(self.cluster.node_ids) // 2:
            self.logger.info(f"Became LEADER for term {self.term}")
            self.state = NodeState.LEADER
        else:
            self.state = NodeState.FOLLOWER
            self.election_timeout = random.uniform(0.15, 0.3)

    async def send_heartbeats(self):
        """Leader sends heartbeats to maintain authority and replicate logs."""
        for target_id in self.cluster.node_ids:
            if target_id != self.node_id:
                # In a real Raft, we'd send the log entries here
                await self.cluster.send_heartbeat(self.node_id, target_id, self.term, self.commit_index)

    async def handle_vote_request(self, candidate_id, term):
        if not self.is_alive: return False
        
        if term > self.term:
            self.term = term
            self.state = NodeState.FOLLOWER
            self.voted_for = None

        if term == self.term and (self.voted_for is None or self.voted_for == candidate_id):
            self.voted_for = candidate_id
            self.last_heartbeat = time.time()
            return True
        return False

    async def handle_heartbeat(self, leader_id, term, leader_commit):
        if not self.is_alive: return False
        
        if term >= self.term:
            self.term = term
            self.state = NodeState.FOLLOWER
            self.last_heartbeat = time.time()
            self.commit_index = leader_commit
            return True
        return False

    async def handle_client_message(self, message):
        """Leader handles incoming messages from clients."""
        if self.state != NodeState.LEADER or not self.is_alive:
            return False

        # 1. Append to local log
        self.log.append((self.term, message))
        entry_index = len(self.log) - 1

        # 2. Replicate to followers
        replications = 1 # Self
        replication_tasks = [self.cluster.replicate_entry(self.node_id, target_id, entry_index, message) 
                             for target_id in self.cluster.node_ids if target_id != self.node_id]
        
        if replication_tasks:
            results = await asyncio.gather(*replication_tasks)
            replications += sum(1 for success in results if success)

        # 3. Commit if majority reached
        if replications > len(self.cluster.node_ids) // 2:
            self.commit_index = entry_index
            return True
        
        return False

    async def handle_replicate_entry(self, leader_id, index, message):
        if not self.is_alive: return False
        
        # Simplified: just append if index matches or is next
        # In real Raft, we check previous log index/term
        if len(self.log) <= index:
            self.log.append((0, message)) # Simplified term
        else:
            self.log[index] = (0, message)
        
        return True

    def kill(self):
        self.is_alive = False
        self.logger.warning("NODE KILLED")

class Cluster:
    def __init__(self, num_nodes=5):
        self.node_ids = list(range(num_nodes))
        self.nodes = {}

    def add_node(self, node):
        self.nodes[node.node_id] = node

    def get_leader(self):
        for node in self.nodes.values():
            if node.state == NodeState.LEADER and node.is_alive:
                return node
        return None

    async def send_vote_request(self, candidate_id, target_id, term):
        try:
            return await self.nodes[target_id].handle_vote_request(candidate_id, term)
        except Exception:
            return False

    async def send_heartbeat(self, leader_id, target_id, term, commit_index):
        try:
            await self.nodes[target_id].handle_heartbeat(leader_id, term, commit_index)
        except Exception:
            pass

    async def replicate_entry(self, leader_id, target_id, index, message):
        try:
            return await self.nodes[target_id].handle_replicate_entry(leader_id, index, message)
        except Exception:
            return False

async def chaos_monkey(cluster):
    """Randomly kills nodes during execution."""
    while True:
        await asyncio.sleep(random.uniform(2, 5))
        alive_nodes = [n for n in cluster.nodes.values() if n.is_alive]
        if len(alive_nodes) > 2: # Keep a quorum to avoid total deadlock
            target = random.choice(alive_nodes)
            target.kill()

async def client_sender(cluster, msg_id, metrics):
    """Simulates a client sending a message with retries."""
    start_time = time.perf_counter()
    message = Message(msg_id, f"Payload {msg_id}")
    
    while True:
        leader = cluster.get_leader()
        if leader:
            success = await leader.handle_client_message(message)
            if success:
                latency = time.perf_counter() - start_time
                metrics['latencies'].append(latency)
                metrics['success_count'] += 1
                return
        
        await asyncio.sleep(0.1) # Wait for new leader election

async def main():
    num_nodes = 5
    num_messages = 2000
    cluster = Cluster(num_nodes)
    
    nodes = [Node(i, cluster) for i in range(num_nodes)]
    for node in nodes:
        cluster.add_node(node)

    metrics = {'success_count': 0, 'latencies': []}

    # Start node processes
    node_tasks = [asyncio.create_task(node.run()) for node in nodes]
    # Start chaos monkey
    chaos_task = asyncio.create_task(chaos_monkey(cluster))

    print(f"Simulating {num_messages} messages across {num_nodes} nodes with Chaos Engineering...")
    
    # Wait for initial leader election
    while cluster.get_leader() is None:
        await asyncio.sleep(0.1)

    start_sim_time = time.perf_counter()
    
    # Send messages concurrently
    client_tasks = [asyncio.create_task(client_sender(cluster, i, metrics)) for i in range(num_messages)]
    
    await asyncio.gather(*client_tasks)
    
    end_sim_time = time.perf_counter()
    
    # Cleanup
    for t in node_tasks: t.cancel()
    chaos_task.cancel()

    # Calculate Metrics
    total_time = end_sim_time - start_sim_time
    throughput = metrics['success_count'] / total_time
    avg_latency = sum(metrics['latencies']) / len(metrics['latencies']) if metrics['latencies'] else 0

    print("\n" + "="*30)
    print("SIMULATION METRICS")
    print("="*30)
    print(f"Total Messages Sent: {num_messages}")
    print(f"Successfully Delivered: {metrics['success_count']}")
    print(f"Total Time: {total_time:.2f} seconds")
    print(f"Throughput: {throughput:.2f} msg/sec")
    print(f"Average Latency: {avg_latency*1000:.2f} ms")
    print("="*30)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
