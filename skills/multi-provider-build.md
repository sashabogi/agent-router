---
name: multi-provider-build
description: Build a feature using multiple AI providers for specialized tasks. Uses researcher for discovery, designer for architecture, coder for implementation, and reviewer/critic for quality assurance. Leverages AgentRouter to route each stage to the optimal LLM provider.
allowed-tools: Task, TaskCreate, TaskUpdate, TaskList, invoke_agent, execute_task, execute_pipeline, get_pipeline_status, compare_agents
model: inherit
---

# Multi-Provider Feature Build

Build the requested feature using the best AI provider for each development stage.

## Feature Request

> **$ARGUMENTS**

---

## Execution Plan

This skill orchestrates a complete feature development workflow across multiple AI providers:

| Stage | Role | Purpose | Typical Provider |
|-------|------|---------|------------------|
| 1. Research | `researcher` | Best practices, existing solutions | Gemini 3 Pro |
| 2. Design | `designer` | Architecture & API design | Claude Sonnet |
| 3. Implement | `coder` | Code implementation | DeepSeek Reasoner |
| 4. Review | `reviewer` | Bug detection, edge cases | OpenAI o3 |
| 5. Critique | `critic` | Security & assumption analysis | GPT-5.2 |

---

## Step 1: Create Task Pipeline

Use the `execute_pipeline` tool to create the full task structure with dependencies:

```json
{
  "name": "feature-build",
  "steps": [
    {
      "name": "research",
      "subject": "Research best practices",
      "description": "Research best practices, common patterns, existing solutions, and potential pitfalls for the requested feature. Focus on production-ready approaches.",
      "role": "researcher"
    },
    {
      "name": "design", 
      "subject": "Design technical architecture",
      "description": "Based on research findings, design the technical architecture. Define interfaces, data models, and component interactions.",
      "role": "designer",
      "dependsOn": ["research"]
    },
    {
      "name": "implement",
      "subject": "Implement the feature",
      "description": "Implement the feature according to the architecture design. Write clean, well-documented code following the researched best practices.",
      "role": "coder",
      "dependsOn": ["design"]
    },
    {
      "name": "review",
      "subject": "Review implementation",
      "description": "Review the implementation for bugs, edge cases, error handling gaps, and potential improvements. Check that it follows the design.",
      "role": "reviewer",
      "dependsOn": ["implement"]
    },
    {
      "name": "critique",
      "subject": "Security and assumption critique",
      "description": "Critique the implementation for security vulnerabilities, invalid assumptions, race conditions, and production readiness concerns.",
      "role": "critic",
      "dependsOn": ["implement"]
    }
  ],
  "context": "$ARGUMENTS"
}
```

---

## Step 2: Execute Pipeline

After creating the pipeline, the tool returns TaskCreate instructions. Execute them in order.

For each phase:
1. Check `TaskList()` for ready tasks (status=pending, no blockers)
2. Execute ready tasks with `execute_task({ taskId: <id> })`
3. Present results to user
4. Wait for dependent tasks to unblock

**Phase 1 (parallel):** Research + Design can start if they have no shared dependencies
**Phase 2:** Implement waits for both Research and Design
**Phase 3 (parallel):** Review and Critique can run simultaneously after Implement

---

## Step 3: Monitor Progress

Use `get_pipeline_status({ pipelineName: "feature-build" })` to check:
- Completed steps with results
- Currently executing steps
- Blocked steps waiting on dependencies
- Time and token usage per step

---

## Step 4: Synthesize Results

After all steps complete, provide a comprehensive summary:

### Research Findings
[Summary of best practices and recommendations from researcher]

### Architecture Design
[Overview of the technical design from designer]

### Implementation
[The implemented code from coder]

### Review Feedback
[Issues and suggestions from reviewer]

### Security Analysis
[Vulnerabilities and concerns from critic]

### Recommended Actions
1. Critical fixes required before merge
2. Suggested improvements for future iterations
3. Technical debt to track

---

## Customization

To modify this workflow:

**Skip stages:** Remove steps from the pipeline definition
**Add stages:** Insert new steps with appropriate dependencies
**Change providers:** Update your AgentRouter config to map roles to different providers
**Parallel execution:** Steps without dependencies execute simultaneously

---

## Example Usage

```
/multi-provider-build Add JWT authentication middleware with refresh token support
```

```
/multi-provider-build Create a rate limiting system with Redis backend
```

```
/multi-provider-build Build a file upload service with S3 integration and virus scanning
```
