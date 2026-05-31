import sqlite3
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class CommunicationHub:
    """
    SQLite-backed event bus / message queue for multi-agent communication.
    Allows agents to send messages to each other asynchronously and persistently.
    """
    def __init__(self, db_path: str = "agent_communication.db"):
        self.db_path = Path(db_path)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender TEXT NOT NULL,
                    receiver TEXT NOT NULL,
                    task_type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()

    def send_message(self, sender: str, receiver: str, task_type: str, data: Dict[str, Any]):
        """
        Send a message (task/data) from one agent to another.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO messages (sender, receiver, task_type, data) VALUES (?, ?, ?, ?)",
                    (sender, receiver, task_type, json.dumps(data))
                )
                conn.commit()
                logger.info(f"[CommHub] Message sent from {sender} to {receiver} (Task: {task_type})")
        except Exception as e:
            logger.error(f"[CommHub] Failed to send message: {e}")

    def check_inbox(self, receiver: str) -> List[Dict[str, Any]]:
        """
        Retrieve all pending messages for a specific agent and mark them as PROCESSING.
        """
        messages = []
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id, sender, task_type, data, created_at FROM messages WHERE receiver = ? AND status = 'PENDING'",
                    (receiver,)
                )
                rows = cursor.fetchall()
                
                for row in rows:
                    msg_id, sender, task_type, data_str, created_at = row
                    messages.append({
                        "id": msg_id,
                        "sender": sender,
                        "receiver": receiver,
                        "task_type": task_type,
                        "data": json.loads(data_str),
                        "created_at": created_at
                    })
                    # Mark as processing so it isn't picked up twice
                    cursor.execute("UPDATE messages SET status = 'PROCESSING' WHERE id = ?", (msg_id,))
                
                conn.commit()
        except Exception as e:
            logger.error(f"[CommHub] Failed to check inbox for {receiver}: {e}")
            
        return messages

    def mark_completed(self, message_id: int):
        """
        Mark a message as COMPLETED.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE messages SET status = 'COMPLETED' WHERE id = ?", (message_id,))
                conn.commit()
                logger.debug(f"[CommHub] Message {message_id} marked as COMPLETED")
        except Exception as e:
            logger.error(f"[CommHub] Failed to mark message {message_id} completed: {e}")
