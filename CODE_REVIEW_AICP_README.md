# Code Review AICP Documentation

## Overview

The `code_review_aicp.py` script is an automated code review tool specifically designed for the Lumina Outreach project. It analyzes TypeScript/JavaScript code for quality, security, and best practices violations.

## Features

### Code Analysis
- **Security Analysis**: Detects potential security vulnerabilities including:
  - Use of `eval()` function
  - Unsafe DOM manipulation with `innerHTML`
  - Password exposure in logs or storage
  - HTTP usage instead of HTTPS
  - Environment variable exposure in client code

- **Quality Analysis**: Identifies code quality issues such as:
  - Use of `var` instead of `const`/`let`
  - Loose equality operators (`==`, `!=`)
  - Empty catch blocks
  - Console.log statements (for production cleanup)
  - TODO/FIXME/HACK comments
  - Debugger statements

- **Performance Analysis**: Spots performance issues like:
  - Inefficient loops
  - DOM query patterns that should be cached
  - Unnecessary object creation in loops

### Project Structure Validation
- Checks for essential project files (package.json, tsconfig.json, .gitignore, README.md)
- Validates package.json structure and required fields
- Suggests security-related npm scripts

### External Tool Integration
- Integrates with ESLint when available
- Runs TypeScript compiler checks
- Gracefully handles missing tools

## Usage

### Basic Usage
```bash
# Review current directory
python code_review_aicp.py

# Review specific directory
python code_review_aicp.py --path ./server

# Review with verbose output
python code_review_aicp.py --verbose
```

### Advanced Usage
```bash
# Generate detailed report with fix suggestions
python code_review_aicp.py --fix --verbose

# Save report to JSON file
python code_review_aicp.py --output review_report.json

# Skip external linters (faster execution)
python code_review_aicp.py --no-linters

# Review specific path with comprehensive reporting
python code_review_aicp.py --path ./client --report --fix
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `--path PATH` | Path to the project directory to review (default: current directory) |
| `--report` | Generate detailed JSON report |
| `--fix` | Show fix suggestions for issues |
| `--verbose, -v` | Enable verbose output |
| `--no-linters` | Skip running external linters |
| `--output, -o` | Output file for the report (JSON format) |

## Output Format

### Summary Report
The tool provides a color-coded summary showing:
- Total number of issues found
- Breakdown by severity (Errors, Warnings, Info)
- Breakdown by category (Security, Quality, Performance, Structure)
- Top files with most issues

### Detailed Issues (with --fix flag)
Each issue includes:
- File path and line number
- Severity level and category
- Description of the issue
- Fix suggestion (when available)
- Rule ID for reference

### JSON Report (with --output or --report)
Structured JSON output containing:
```json
{
  "timestamp": "2025-08-12T19:04:52.123456",
  "project_path": "/path/to/project",
  "total_issues": 1432,
  "summary": {
    "error": 0,
    "warning": 1419,
    "info": 13
  },
  "categories": {
    "quality": 1413,
    "security": 4,
    "performance": 13,
    "structure": 2
  },
  "issues": [
    {
      "file_path": "src/index.ts",
      "line_number": 84,
      "severity": "warning",
      "category": "quality",
      "description": "Use strict equality (===) instead of loose equality (==)",
      "suggestion": null,
      "rule_id": "quality-==\\s*[\\'\"]"
    }
  ]
}
```

## Integration with CI/CD

The script is designed to integrate well with CI/CD pipelines:

### Exit Codes
- `0`: Success (no errors found)
- `1`: Errors found or execution failed

### Example CI Integration
```yaml
# .github/workflows/code-review.yml
- name: Run Code Review
  run: |
    python code_review_aicp.py --output code_review_report.json
    # Upload report as artifact if needed
```

## Customization

The script can be easily extended by modifying the pattern matching rules in:
- `analyze_typescript_security()`: Add new security patterns
- `analyze_typescript_quality()`: Add new quality patterns  
- `analyze_typescript_performance()`: Add new performance patterns

## Best Practices

1. **Regular Reviews**: Run the tool regularly during development
2. **CI Integration**: Include in your continuous integration pipeline
3. **Incremental Fixes**: Use `--fix` to get actionable suggestions
4. **Custom Rules**: Extend the tool with project-specific rules
5. **Team Standards**: Use the output to establish coding standards

## Troubleshooting

### Common Issues
- **Permission Denied**: Ensure the script has execute permissions (`chmod +x code_review_aicp.py`)
- **Python Version**: Requires Python 3.6 or higher
- **Missing Dependencies**: The script uses only standard library modules
- **Large Codebases**: Use `--path` to analyze specific directories for faster execution

### Performance Tips
- Use `--no-linters` for faster execution when external tools aren't needed
- Target specific directories with `--path` for large projects
- Use `--verbose` to monitor progress on large codebases

## Support

For issues or feature requests related to this tool, please refer to the project documentation or contact the development team.