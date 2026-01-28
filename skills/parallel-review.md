---
name: parallel-review
description: Get code reviews from multiple AI providers simultaneously for diverse perspectives. Each provider brings different strengths - security focus, performance optimization, best practices, etc. Great for critical code paths or security-sensitive changes.
allowed-tools: compare_agents, invoke_agent, TaskCreate, TaskUpdate, TaskList
model: inherit
---

# Parallel Multi-Provider Code Review

Get comprehensive code feedback by running reviews across multiple AI providers simultaneously. Each provider brings unique perspectives and catches different issues.

## Code to Review

> **$ARGUMENTS**

---

## Why Multi-Provider Review?

Different LLM providers have different training data and strengths:

| Provider | Typical Strengths |
|----------|-------------------|
| OpenAI (o3) | Logical reasoning, edge case detection |
| DeepSeek | Deep code analysis, algorithmic improvements |
| Anthropic | Security awareness, clear explanations |
| Gemini | Documentation, API design patterns |

By reviewing with multiple providers, you get coverage that no single model provides.

---

## Execution

### Option A: Quick Parallel Review (Recommended)

Use `compare_agents` for simultaneous review from all configured review-capable roles:

```json
{
  "roles": ["reviewer", "critic", "coder"],
  "task": "Review this code thoroughly. Focus on:\n1. Bugs and logic errors\n2. Security vulnerabilities\n3. Performance issues\n4. Code style and maintainability\n5. Edge cases and error handling\n\nCode to review:\n\n$ARGUMENTS"
}
```

This sends the same request to all three roles in parallel and returns all responses.

### Option B: Sequential Deep Review

For more thorough analysis where each reviewer builds on previous feedback:

**Step 1: Initial Review**
```json
{
  "role": "reviewer",
  "task": "Perform an initial code review focusing on correctness, bugs, and edge cases:\n\n$ARGUMENTS"
}
```

**Step 2: Security Analysis**
```json
{
  "role": "critic", 
  "task": "Analyze this code for security vulnerabilities, unsafe patterns, and assumption violations:\n\n$ARGUMENTS\n\nPrevious review findings: [include step 1 results]"
}
```

**Step 3: Implementation Suggestions**
```json
{
  "role": "coder",
  "task": "Suggest concrete improvements and optimizations for this code. Consider the review and security findings:\n\n$ARGUMENTS\n\nReview findings: [include step 1-2 results]"
}
```

---

## Output Format

Present reviews grouped by provider with clear attribution:

### 🔍 Code Reviewer
**Provider:** [e.g., OpenAI o3]
**Focus:** Correctness & Edge Cases

[Review findings organized by severity]

---

### 🛡️ Security Critic  
**Provider:** [e.g., GPT-5.2]
**Focus:** Vulnerabilities & Assumptions

[Security analysis with specific concerns]

---

### 💡 Implementation Expert
**Provider:** [e.g., DeepSeek Reasoner]
**Focus:** Optimizations & Best Practices

[Concrete improvement suggestions with code examples]

---

## Consolidated Summary

After presenting individual reviews, synthesize into actionable items:

### 🚨 Critical Issues (All Providers Agree)
- [Issues flagged by multiple providers]

### ⚠️ Recommended Changes (Majority Agree)
- [Issues flagged by 2+ providers]

### 💭 Suggestions (Single Provider)
- [Interesting points from individual reviews]

### ✅ Strengths Noted
- [Positive feedback to preserve]

---

## Example Usage

```
/parallel-review 
async function authenticate(token: string): Promise<User> {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await db.users.findById(decoded.userId);
  return user;
}
```

```
/parallel-review [paste your code or provide a file path]
```

---

## Configuration

The roles used for review map to your AgentRouter config:

```yaml
# In agent-router.yaml
roles:
  reviewer:
    provider: openai
    model: o3
    system_prompt: "You are a meticulous code reviewer..."
    
  critic:
    provider: openai  
    model: gpt-5.2
    system_prompt: "You are a security-focused critic..."
    
  coder:
    provider: deepseek
    model: deepseek-reasoner
    system_prompt: "You are an expert programmer..."
```

Change provider assignments to customize which LLMs perform each review type.
