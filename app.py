# Required libraries
# pip install mem0ai langchain langchain-openai playwright

import os
from typing import List, Dict, Any
from mem0 import Memory
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

# Initialize Mem0 Memory
mem0_memory = Memory()

# Initialize LLM with the latest pattern
llm = ChatOpenAI(
    model="gpt-4o",
    temperature=0.7,
)

# Initialize MemorySaver for persistence
memory_saver = MemorySaver()

# Create template for DevOps assistance
template = """You are an expert Infrastructure DevOps engineer.
Based on the user's request, provide guidance, solutions, or code samples for infrastructure, CI/CD, cloud services, containerization, or automation tasks.

Relevant past knowledge:
{memories}

Chat history:
{chat_history}

New request from user:
{user_input}

Provide a clear, concise solution with explanations where needed. Include code snippets, commands, or configuration examples when appropriate.
"""

prompt = ChatPromptTemplate.from_template(template)

# Create chain with the latest LangChain patterns
def create_chain():
    return (
        {
            "memories": lambda x: x["memories"],
            "chat_history": lambda _: "",
            "user_input": lambda x: x["user_input"],
        }
        | prompt
        | llm
        | StrOutputParser()
    ).compile(checkpointer=memory_saver)  # Add MemorySaver as the checkpointer

def generate_playwright_test(user_request: str, user_id: str = "default_user") -> str:
    # Get relevant memories from Mem0
    relevant_memories = mem0_memory.search(query=user_request, user_id=user_id, limit=5)
    memories_str = "\n".join([f"- {entry['memory']}" for entry in relevant_memories.get("results", [])])

    # Create chain for this request
    chain = create_chain()
    
    # Generate response using LangChain
    response = chain.invoke({
        "memories": memories_str,
        "user_input": user_request
    })
    
    # Save to Mem0 memory
    mem0_memory.add(user_request, memory_type="user_request", user_id=user_id)
    mem0_memory.add(response, memory_type="generated_test", user_id=user_id)

    return response
