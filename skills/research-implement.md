---
name: research-implement
description: Two-phase development workflow - research best practices with a knowledge-focused provider, then implement with a specialized coder. Ideal for unfamiliar domains, new technologies, or when you want implementation grounded in current best practices.
allowed-tools: invoke_agent, execute_task, TaskCreate, TaskUpdate, TaskList
model: inherit
---

# Research Then Implement

A two-phase workflow that ensures your implementation is grounded in current best practices. First, research the domain thoroughly. Then, implement with full awareness of patterns, pitfalls, and recommendations.

## Request

> **$ARGUMENTS**

---

## Why Research First?

Jumping straight to implementation often leads to:
- Reinventing the wheel
- Missing established patterns
- Security anti-patterns
- Technical debt from poor initial decisions

By researching first with a knowledge-focused model (like Gemini with its large context), you build a foundation for high-quality implementation.

---

## Phase 1: Research

Use the `researcher` role to survey the domain:

```json
{
  "role": "researcher",
  "task": "Research best practices, common patterns, and potential pitfalls for: $ARGUMENTS\n\nProvide:\n1. Recommended approaches (with trade-offs)\n2. Common mistakes to avoid\n3. Security considerations\n4. Performance implications\n5. Relevant libraries or frameworks\n6. Example implementations or references",
  "context": "This research will inform a subsequent implementation. Be thorough, specific, and actionable. Cite sources where possible."
}
```

### Research Output

Present the research findings clearly before proceeding:

**Recommended Approach:** [Primary recommendation with rationale]

**Alternative Approaches:**
- [Option B with trade-offs]
- [Option C with trade-offs]

**Common Pitfalls:**
1. [Mistake 1 and how to avoid]
2. [Mistake 2 and how to avoid]

**Security Considerations:**
- [Security point 1]
- [Security point 2]

**Recommended Libraries:**
- [Library 1]: [why]
- [Library 2]: [why]

---

## Phase 2: Implement

After presenting research, ask user for confirmation or adjustments. Then implement:

```json
{
  "role": "coder",
  "task": "Implement $ARGUMENTS following the researched best practices. Ensure the implementation:\n1. Uses the recommended approach\n2. Avoids the identified pitfalls\n3. Addresses security considerations\n4. Follows established patterns",
  "context": "Research findings:\n[Insert full research output from Phase 1]\n\nUser preferences: [Any user feedback on research]"
}
```

### Implementation Output

Present the implementation with clear documentation:

**Implementation Overview:**
[High-level description of what was built]

**Code:**
```
[The implemented code]
```

**How It Addresses Research:**
- ✅ [Research point 1]: [How it's addressed]
- ✅ [Research point 2]: [How it's addressed]

**Usage Example:**
```
[How to use the implementation]
```

---

## Phase 3: Verify (Optional)

For critical implementations, verify that research recommendations were followed:

```json
{
  "role": "critic",
  "task": "Verify this implementation follows the researched best practices. Check for:\n1. Alignment with recommended approach\n2. Absence of identified pitfalls\n3. Security consideration coverage\n4. Any gaps or oversights",
  "context": "Research:\n[Insert research]\n\nImplementation:\n[Insert code]"
}
```

---

## Provider Configuration

This workflow benefits from specialized providers:

```yaml
# In agent-router.yaml
roles:
  researcher:
    provider: google
    model: gemini-3-pro
    system_prompt: |
      You are a technical researcher with access to extensive documentation 
      and best practices. Provide thorough, well-sourced research that can 
      guide implementation decisions.
      
  coder:
    provider: deepseek
    model: deepseek-reasoner
    system_prompt: |
      You are an expert programmer who writes clean, well-documented code.
      When given research context, you incorporate best practices and avoid
      known pitfalls.
      
  critic:
    provider: anthropic
    model: claude-sonnet-4-5
    system_prompt: |
      You are a technical critic who verifies implementations against 
      requirements and best practices. Be thorough but constructive.
```

**Why these providers?**
- **Gemini** for research: Large context window, strong at synthesis
- **DeepSeek Reasoner** for coding: Excellent at complex implementations
- **Claude** for critique: Clear explanations, good at spotting gaps

---

## Example Usage

```
/research-implement Add rate limiting to our Express API with Redis
```

```
/research-implement Create a WebSocket server with authentication and reconnection handling
```

```
/research-implement Implement a job queue with retries, dead letter queue, and monitoring
```

---

## Tips

1. **Be specific in your request** - The more context, the better the research
2. **Review research before implementation** - Confirm the approach makes sense for your context
3. **Add project context** - Mention your stack, constraints, or preferences
4. **Iterate if needed** - You can ask for more research on specific points
