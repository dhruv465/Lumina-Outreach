---
inclusion: always
---

# AI Development Guidelines

## Project Architecture & Navigation

- Analyze project structure before making changes (client/server architecture with React frontend and Node.js backend)
- Identify key components: UI components, API services, controllers, and data models
- Follow existing patterns for new code implementation
- Map dependencies between components before modifications

## Code Style & Conventions

- Use TypeScript for type safety throughout the codebase
- Follow React component patterns in client code
- Maintain consistent error handling patterns
- Document complex functions with JSDoc comments
- Use async/await for asynchronous operations
- Follow existing naming conventions (camelCase for variables/functions, PascalCase for components/classes)

## Technical Development Approach

- Prioritize modular, scalable architecture
- Ensure backward compatibility when modifying existing APIs
- Implement proper error handling and logging
- Write testable code with clear separation of concerns
- Consider performance implications, especially for real-time features

## AI System Development

- Implement AI features with clear integration points to existing services
- Design AI components with monitoring and observability in mind
- Consider latency requirements for real-time voice/call features
- Ensure AI systems have appropriate fallback mechanisms
- Document AI model dependencies and version requirements

## Ethical Considerations

- Implement privacy-preserving techniques for user data
- Ensure AI systems are transparent in their decision-making process
- Consider bias mitigation strategies in AI implementations
- Respect data minimization principles

## Continuous Improvement

- Document architectural decisions and their rationales
- Keep dependencies updated while ensuring compatibility
- Refactor code when adding new features to maintain quality
- Stay updated on relevant AI research and technologies