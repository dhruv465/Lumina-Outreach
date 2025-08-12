#!/usr/bin/env python3
"""
Code Review AICP (AI Code Patrol) - Automated Code Review Tool
============================================================

A comprehensive code review tool designed for the Lumina Outreach project.
This tool analyzes TypeScript/JavaScript code for quality, security, and best practices.

Usage:
    python code_review_aicp.py [--path PATH] [--fix] [--report] [--verbose]

Features:
    - TypeScript/JavaScript code analysis
    - Security vulnerability detection
    - Code quality metrics
    - Best practices validation
    - Automated fix suggestions
    - Comprehensive reporting

Author: AICP System
Version: 1.0.0
"""

import os
import sys
import json
import argparse
import subprocess
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime


@dataclass
class CodeIssue:
    """Represents a code issue found during review."""
    file_path: str
    line_number: int
    severity: str  # 'error', 'warning', 'info'
    category: str  # 'security', 'quality', 'style', 'performance'
    description: str
    suggestion: Optional[str] = None
    rule_id: Optional[str] = None


class CodeReviewAICP:
    """Main code review engine for AICP."""
    
    def __init__(self, root_path: str = ".", verbose: bool = False):
        self.root_path = Path(root_path).resolve()
        self.verbose = verbose
        self.issues: List[CodeIssue] = []
        
        # File patterns to analyze
        self.typescript_patterns = ["*.ts", "*.tsx", "*.js", "*.jsx"]
        self.config_patterns = ["*.json", "package.json", "tsconfig.json"]
        
        # Directories to skip
        self.skip_dirs = {
            "node_modules", ".git", "dist", "build", ".next", 
            "coverage", ".nyc_output", "tmp", ".tmp"
        }
    
    def log(self, message: str, level: str = "INFO"):
        """Log message if verbose mode is enabled."""
        if self.verbose:
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] {level}: {message}")
    
    def find_files(self, patterns: List[str]) -> List[Path]:
        """Find files matching given patterns, excluding skip directories."""
        files = []
        for pattern in patterns:
            for file_path in self.root_path.rglob(pattern):
                # Skip if any parent directory is in skip_dirs
                if any(skip_dir in file_path.parts for skip_dir in self.skip_dirs):
                    continue
                files.append(file_path)
        return files
    
    def analyze_typescript_security(self, file_path: Path, content: str):
        """Analyze TypeScript/JavaScript files for security issues."""
        lines = content.split('\n')
        
        security_patterns = [
            (r'eval\s*\(', "Avoid using eval() - potential security risk", "security"),
            (r'innerHTML\s*=', "Use textContent or safer DOM methods instead of innerHTML", "security"),
            (r'document\.write\s*\(', "Avoid document.write() - XSS vulnerability", "security"),
            (r'process\.env\.[A-Z_]+\s*\)', "Avoid exposing environment variables in client code", "security"),
            (r'localStorage\.setItem.*password', "Avoid storing passwords in localStorage", "security"),
            (r'sessionStorage\.setItem.*password', "Avoid storing passwords in sessionStorage", "security"),
            (r'console\.log\s*\(.*password', "Remove password logging in production", "security"),
            (r'fetch\s*\(\s*[\'"][^\'"]*(http://)', "Use HTTPS instead of HTTP for API calls", "security"),
        ]
        
        for i, line in enumerate(lines, 1):
            for pattern, description, category in security_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    self.issues.append(CodeIssue(
                        file_path=str(file_path.relative_to(self.root_path)),
                        line_number=i,
                        severity="error" if "password" in description.lower() or "eval" in description.lower() else "warning",
                        category=category,
                        description=description,
                        rule_id=f"security-{pattern[:10]}"
                    ))
    
    def analyze_typescript_quality(self, file_path: Path, content: str):
        """Analyze TypeScript/JavaScript files for code quality issues."""
        lines = content.split('\n')
        
        quality_patterns = [
            (r'var\s+\w+', "Use 'const' or 'let' instead of 'var'", "quality"),
            (r'==\s*[\'"]', "Use strict equality (===) instead of loose equality (==)", "quality"),
            (r'!=\s*[\'"]', "Use strict inequality (!==) instead of loose inequality (!=)", "quality"),
            (r'function\s+\w+\s*\(\s*\)\s*\{[^}]*\}', "Consider using arrow functions for consistency", "style"),
            (r'catch\s*\(\s*\w+\s*\)\s*\{\s*\}', "Empty catch blocks should handle errors properly", "quality"),
            (r'console\.log\s*\(', "Remove console.log statements before production", "quality"),
            (r'TODO|FIXME|HACK', "Address TODO/FIXME/HACK comments", "quality"),
            (r'debugger\s*;', "Remove debugger statements before production", "quality"),
        ]
        
        for i, line in enumerate(lines, 1):
            for pattern, description, category in quality_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    severity = "error" if "debugger" in description.lower() else "warning"
                    self.issues.append(CodeIssue(
                        file_path=str(file_path.relative_to(self.root_path)),
                        line_number=i,
                        severity=severity,
                        category=category,
                        description=description,
                        rule_id=f"quality-{pattern[:10]}"
                    ))
    
    def analyze_typescript_performance(self, file_path: Path, content: str):
        """Analyze TypeScript/JavaScript files for performance issues."""
        lines = content.split('\n')
        
        performance_patterns = [
            (r'for\s*\(\s*let\s+\w+\s*=\s*0.*length\s*;\s*\w+\+\+\s*\)', 
             "Consider using for...of or forEach for better readability", "performance"),
            (r'document\.getElementById.*loop', 
             "Cache DOM queries outside loops", "performance"),
            (r'new\s+Date\(\).*loop', 
             "Avoid creating new Date objects in loops", "performance"),
            (r'JSON\.parse\s*\(.*\+', 
             "Avoid string concatenation with JSON.parse", "performance"),
        ]
        
        for i, line in enumerate(lines, 1):
            for pattern, description, category in performance_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    self.issues.append(CodeIssue(
                        file_path=str(file_path.relative_to(self.root_path)),
                        line_number=i,
                        severity="info",
                        category=category,
                        description=description,
                        rule_id=f"performance-{pattern[:10]}"
                    ))
    
    def analyze_file(self, file_path: Path):
        """Analyze a single file for issues."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            self.log(f"Analyzing {file_path.relative_to(self.root_path)}")
            
            if file_path.suffix in ['.ts', '.tsx', '.js', '.jsx']:
                self.analyze_typescript_security(file_path, content)
                self.analyze_typescript_quality(file_path, content)
                self.analyze_typescript_performance(file_path, content)
            
        except Exception as e:
            self.log(f"Error analyzing {file_path}: {str(e)}", "ERROR")
    
    def check_project_structure(self):
        """Check for project structure and configuration issues."""
        # Check for essential files
        essential_files = [
            "package.json",
            "tsconfig.json",
            ".gitignore",
            "README.md"
        ]
        
        for file_name in essential_files:
            file_path = self.root_path / file_name
            if not file_path.exists():
                self.issues.append(CodeIssue(
                    file_path=file_name,
                    line_number=0,
                    severity="warning",
                    category="structure",
                    description=f"Missing essential file: {file_name}",
                    suggestion=f"Create {file_name} for better project structure"
                ))
        
        # Check package.json structure
        package_json_path = self.root_path / "package.json"
        if package_json_path.exists():
            try:
                with open(package_json_path, 'r') as f:
                    package_data = json.load(f)
                
                required_fields = ["name", "version", "description", "scripts"]
                for field in required_fields:
                    if field not in package_data:
                        self.issues.append(CodeIssue(
                            file_path="package.json",
                            line_number=0,
                            severity="warning",
                            category="structure",
                            description=f"Missing required field in package.json: {field}"
                        ))
                
                # Check for security-related scripts
                scripts = package_data.get("scripts", {})
                if "audit" not in scripts:
                    self.issues.append(CodeIssue(
                        file_path="package.json",
                        line_number=0,
                        severity="info",
                        category="security",
                        description="Consider adding 'npm audit' script for security checks",
                        suggestion="Add 'audit': 'npm audit' to scripts section"
                    ))
                    
            except json.JSONDecodeError:
                self.issues.append(CodeIssue(
                    file_path="package.json",
                    line_number=0,
                    severity="error",
                    category="structure",
                    description="Invalid JSON in package.json"
                ))
    
    def run_external_linters(self):
        """Run external linting tools if available."""
        linters = [
            {
                "name": "ESLint",
                "command": ["npx", "eslint", "--format", "json", "."],
                "check_command": ["npx", "eslint", "--version"]
            },
            {
                "name": "TypeScript",
                "command": ["npx", "tsc", "--noEmit"],
                "check_command": ["npx", "tsc", "--version"]
            }
        ]
        
        for linter in linters:
            try:
                # Check if linter is available
                subprocess.run(
                    linter["check_command"], 
                    capture_output=True, 
                    check=True,
                    cwd=self.root_path
                )
                
                self.log(f"Running {linter['name']} linter...")
                
                # Run the actual linter
                result = subprocess.run(
                    linter["command"],
                    capture_output=True,
                    text=True,
                    cwd=self.root_path
                )
                
                if linter["name"] == "ESLint" and result.stdout:
                    try:
                        eslint_results = json.loads(result.stdout)
                        for file_result in eslint_results:
                            for message in file_result.get("messages", []):
                                severity_map = {1: "warning", 2: "error"}
                                self.issues.append(CodeIssue(
                                    file_path=file_result["filePath"].replace(str(self.root_path) + "/", ""),
                                    line_number=message.get("line", 0),
                                    severity=severity_map.get(message.get("severity", 1), "warning"),
                                    category="linting",
                                    description=f"ESLint: {message.get('message', 'Unknown error')}",
                                    rule_id=message.get("ruleId")
                                ))
                    except json.JSONDecodeError:
                        pass
                
            except (subprocess.CalledProcessError, FileNotFoundError):
                self.log(f"{linter['name']} not available, skipping...")
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate a comprehensive report of all issues found."""
        report = {
            "timestamp": datetime.now().isoformat(),
            "project_path": str(self.root_path),
            "total_issues": len(self.issues),
            "summary": {
                "error": len([i for i in self.issues if i.severity == "error"]),
                "warning": len([i for i in self.issues if i.severity == "warning"]),
                "info": len([i for i in self.issues if i.severity == "info"])
            },
            "categories": {},
            "issues": [asdict(issue) for issue in self.issues]
        }
        
        # Group by category
        for issue in self.issues:
            category = issue.category
            if category not in report["categories"]:
                report["categories"][category] = 0
            report["categories"][category] += 1
        
        return report
    
    def print_summary(self):
        """Print a summary of issues found."""
        if not self.issues:
            print("✅ No issues found! Code looks good.")
            return
        
        print(f"\n📊 Code Review Summary")
        print("=" * 50)
        
        # Count by severity
        errors = len([i for i in self.issues if i.severity == "error"])
        warnings = len([i for i in self.issues if i.severity == "warning"])
        info = len([i for i in self.issues if i.severity == "info"])
        
        print(f"Total Issues: {len(self.issues)}")
        print(f"  🔴 Errors: {errors}")
        print(f"  🟡 Warnings: {warnings}")
        print(f"  🔵 Info: {info}")
        
        # Count by category
        categories = {}
        for issue in self.issues:
            categories[issue.category] = categories.get(issue.category, 0) + 1
        
        print(f"\nBy Category:")
        for category, count in sorted(categories.items()):
            print(f"  {category.capitalize()}: {count}")
        
        # Show top issues
        print(f"\n🔍 Issues by File:")
        file_issues = {}
        for issue in self.issues:
            file_issues[issue.file_path] = file_issues.get(issue.file_path, 0) + 1
        
        for file_path, count in sorted(file_issues.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {file_path}: {count} issues")
    
    def run_review(self, run_linters: bool = True):
        """Run the complete code review process."""
        self.log("Starting AICP Code Review...")
        
        # Find and analyze files
        ts_files = self.find_files(self.typescript_patterns)
        self.log(f"Found {len(ts_files)} TypeScript/JavaScript files")
        
        for file_path in ts_files:
            self.analyze_file(file_path)
        
        # Check project structure
        self.check_project_structure()
        
        # Run external linters if requested
        if run_linters:
            self.run_external_linters()
        
        self.log("Code review completed")


def main():
    """Main function to run the code review tool."""
    parser = argparse.ArgumentParser(
        description="AICP Code Review Tool - Automated code analysis for TypeScript/JavaScript projects",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python code_review_aicp.py                    # Review current directory
  python code_review_aicp.py --path ./server    # Review specific directory
  python code_review_aicp.py --report --verbose # Generate detailed report
  python code_review_aicp.py --fix              # Show fix suggestions
        """
    )
    
    parser.add_argument(
        "--path", 
        default=".", 
        help="Path to the project directory to review (default: current directory)"
    )
    parser.add_argument(
        "--report", 
        action="store_true", 
        help="Generate detailed JSON report"
    )
    parser.add_argument(
        "--fix", 
        action="store_true", 
        help="Show fix suggestions for issues"
    )
    parser.add_argument(
        "--verbose", "-v", 
        action="store_true", 
        help="Enable verbose output"
    )
    parser.add_argument(
        "--no-linters", 
        action="store_true", 
        help="Skip running external linters"
    )
    parser.add_argument(
        "--output", "-o", 
        help="Output file for the report (JSON format)"
    )
    
    args = parser.parse_args()
    
    # Verify the path exists
    if not os.path.exists(args.path):
        print(f"❌ Error: Path '{args.path}' does not exist.")
        sys.exit(1)
    
    # Create and run the code reviewer
    reviewer = CodeReviewAICP(args.path, verbose=args.verbose)
    reviewer.run_review(run_linters=not args.no_linters)
    
    # Print summary
    reviewer.print_summary()
    
    # Show detailed issues if fix flag is used
    if args.fix and reviewer.issues:
        print(f"\n🔧 Detailed Issues and Suggestions:")
        print("=" * 60)
        
        for i, issue in enumerate(reviewer.issues[:20], 1):  # Show first 20 issues
            print(f"\n{i}. {issue.file_path}:{issue.line_number}")
            print(f"   [{issue.severity.upper()}] {issue.category}: {issue.description}")
            if issue.suggestion:
                print(f"   💡 Suggestion: {issue.suggestion}")
            if issue.rule_id:
                print(f"   📋 Rule: {issue.rule_id}")
        
        if len(reviewer.issues) > 20:
            print(f"\n... and {len(reviewer.issues) - 20} more issues")
    
    # Generate report if requested
    if args.report or args.output:
        report = reviewer.generate_report()
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(report, f, indent=2)
            print(f"\n📄 Report saved to: {args.output}")
        else:
            print(f"\n📄 Detailed Report:")
            print(json.dumps(report, indent=2))
    
    # Exit with appropriate code
    errors = len([i for i in reviewer.issues if i.severity == "error"])
    if errors > 0:
        print(f"\n❌ Review completed with {errors} errors.")
        sys.exit(1)
    else:
        print(f"\n✅ Review completed successfully.")
        sys.exit(0)


if __name__ == "__main__":
    main()