#!/bin/bash
set -euo pipefail

NIX_STORE_NAR="${NIX_STORE_NAR:-/tmp/nix-store.nar}"

# Explicitly use the nix-store from the system profile for sudo (there is no /root/.nix-profile)
nix_store_cmd="/nix/var/nix/profiles/default/bin/nix-store"

# Function to restore Nix store from NAR
restore_nix_store() {
    echo "=== Restoring Nix store from NAR ==="
    if [ -f "$NIX_STORE_NAR" ]; then
        echo "$NIX_STORE_NAR file found, importing..."
        sudo $nix_store_cmd --import --quiet < "$NIX_STORE_NAR"
        echo "NAR import completed"
    else
        echo "No NAR file found, skipping import"
    fi
}

# Function to install devenv
install_devenv() {
    echo "=== Installing devenv ==="
    # Create explicit GC root directory first
    sudo mkdir -p /nix/var/nix/gcroots/ci
    
    if command -v devenv &> /dev/null; then
        echo "devenv already available, skipping installation"
    else
        echo "devenv not found, installing..."
        nix profile install --accept-flake-config nixpkgs#devenv
    fi
    
    echo "$HOME/.nix-profile/bin" >> $GITHUB_PATH
    
    # Add explicit GC root for devenv profile
    sudo ln -sf $HOME/.nix-profile /nix/var/nix/gcroots/ci/profile
    
    # Also add the specific devenv store path if available
    if command -v devenv &> /dev/null; then
        DEVENV_PATH=$(readlink -f $(which devenv))
        DEVENV_STORE_PATH=$(echo $DEVENV_PATH | cut -d/ -f1-4)
        sudo ln -sf $DEVENV_STORE_PATH /nix/var/nix/gcroots/ci/devenv
    fi
}

# Function to build devenv shell
build_devenv_shell() {
    if ! devenv shell --help &> /dev/null; then
        echo "devenv shell command not working properly"
        exit 1
    fi
    
    # Build the shell to ensure all dependencies are available
    devenv shell --verbose -- date
    
    # Add shell environment derivations to GC roots
    if [ -d .devenv ]; then
        # Find all store paths referenced by devenv
        find .devenv -name "*.drv" -o -name "*" -type f -exec grep -l "/nix/store" {} \; 2>/dev/null | \
        xargs grep -ho "/nix/store/[a-z0-9]*-[^'\" ]*" 2>/dev/null | \
        sort -u | while read store_path; do
            if [ -e "$store_path" ]; then
                hash=$(basename "$store_path" | cut -d- -f1)
                sudo ln -sf "$store_path" "/nix/var/nix/gcroots/ci/devenv-$hash" 2>/dev/null || true
            fi
        done
    fi
}

# Function to get current job ID
get_job_id() {
    # GITHUB_JOB contains the job ID from the workflow file (e.g., "main")
    # But we need the numeric job ID for the API. Let's check if we can get it from the API.
    if [ -n "$GITHUB_RUN_ID" ] && [ -n "$GITHUB_REPOSITORY" ] && [ -n "$GITHUB_JOB" ]; then
        # Get all jobs for this run and find the one matching GITHUB_JOB
        gh api \
            -H "Accept: application/vnd.github+json" \
            "/repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" \
            --jq ".jobs[] | select(.name == \"$GITHUB_JOB\") | .id" 2>/dev/null || echo ""
    fi
}

# Function to create GitHub status
# Uses the Status API instead of Check Runs API because GitHub Actions
# ignores custom details_url for checks created by the GitHub Actions app
create_status() {
    local name="$1"
    local step_number="${2:-}"  # Optional step number for direct linking
    
    if [ -n "$GITHUB_SHA" ] && [ -n "$GITHUB_REPOSITORY" ]; then
        # Build target URL to link to the specific step if step_number provided
        local target_url=""
        if [ -n "$GITHUB_RUN_ID" ]; then
            local job_id=$(get_job_id)
            if [ -n "$job_id" ] && [ -n "$step_number" ]; then
                # Direct link to specific step using anchor on job URL
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/job/${job_id}#step:${step_number}:1"
            elif [ -n "$job_id" ]; then
                # Link to job without step anchor
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/job/$job_id"
            else
                # Fallback to workflow run
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
            fi
        fi
        
        # Create the status (remove "> /dev/null" to see API response for debugging)
        gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            /repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA \
            -f state="pending" \
            -f context="$name" \
            -f description="Running $name..." \
            ${target_url:+-f target_url="$target_url"} > /dev/null
    fi
}

# Function to update GitHub status
update_status() {
    local context="$1"
    local state="$2"  # success, failure, error, pending
    local step_number="${3:-}"  # Optional step number for direct linking
    
    if [ -n "$context" ] && [ -n "$GITHUB_REPOSITORY" ] && [ -n "$GITHUB_SHA" ]; then
        local description=""
        case "$state" in
            "success") description="$context passed" ;;
            "failure") description="$context failed" ;;
            "error") description="$context error" ;;
            "pending") description="Running $context..." ;;
        esac
        
        # Build target URL - Status API does NOT maintain URLs between calls
        local target_url=""
        if [ -n "$GITHUB_RUN_ID" ]; then
            local job_id=$(get_job_id)
            if [ -n "$job_id" ] && [ -n "$step_number" ]; then
                # Direct link to specific step using anchor on job URL
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/job/${job_id}#step:${step_number}:1"
            elif [ -n "$job_id" ]; then
                # Link to job without step anchor
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/job/$job_id"
            else
                # Fallback to workflow run
                target_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
            fi
        fi
        
        # Update the status (remove "> /dev/null" to see API response for debugging)
        gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            /repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA \
            -f state="$state" \
            -f context="$context" \
            -f description="$description" \
            ${target_url:+-f target_url="$target_url"} > /dev/null
    fi
}

# Function to run nx affected with specific task
run_nx_affected() {
    local nx_task="${1:-}"
    local check_name="${2:-$nx_task}"
    local step_number="${3:-}"  # Optional step number for direct linking
    
    if [ -z "$nx_task" ]; then
        echo "Error: No task specified"
        echo "Usage: $0 nx-affected <task> [check-name] [step-number]"
        return 1
    fi
    
    # Create status (includes target URL with step anchor if provided)
    create_status "$check_name" "$step_number"
    
    # Run nx affected and update status based on exit code
    if devenv shell -- nx affected -t "$nx_task"; then
        update_status "$check_name" "success" "$step_number"
        return 0
    else
        update_status "$check_name" "failure" "$step_number"
        return 1
    fi
}

# Function to run garbage collection
run_garbage_collection() {
    echo "=== Running garbage collection ==="
    echo "GC roots before cleanup:"
    sudo find /nix/var/nix/gcroots -type l -exec ls -la {} \; 2>/dev/null || true
    
    echo "Running nix-collect-garbage..."
    nix-collect-garbage --quiet
    
    echo "GC roots after cleanup:"
    sudo find /nix/var/nix/gcroots -type l -exec ls -la {} \; 2>/dev/null || true
}

# Function to export Nix store to NAR
export_nix_store() {
    echo "=== Finding all GC roots ==="
    # Get ALL GC root targets without filtering  
    ALL_GC_ROOT_TARGETS=$(sudo find /nix/var/nix/gcroots -type l -exec readlink {} \; 2>/dev/null | sort -u)
    echo "All GC root targets: $ALL_GC_ROOT_TARGETS"

    # Get store paths from all GC roots (including indirect ones)
    ALL_GC_STORE_PATHS=""
    for root in $ALL_GC_ROOT_TARGETS; do
        if [[ "$root" == /nix/store/* ]]; then
            ALL_GC_STORE_PATHS="$ALL_GC_STORE_PATHS $root"
        elif [[ -e "$root" ]]; then
            # Resolve indirect roots to store paths
            INDIRECT_PATHS=$(sudo $nix_store_cmd -qR "$root" 2>/dev/null || echo "")
            ALL_GC_STORE_PATHS="$ALL_GC_STORE_PATHS $INDIRECT_PATHS"
        fi
    done

    # Also get profile paths
    SYSTEM_PROFILE_PATHS=$(sudo find /nix/var/nix/profiles -type l -exec readlink {} \; \
                                | grep "^/nix/store" | sort -u)
    USER_PROFILE_PATHS=$(find $HOME/.local/state/nix/profiles -type l -exec readlink {} \; 2>/dev/null \
                         | grep "^/nix/store" | sort -u || echo "")

    ALL_PATHS="$ALL_GC_STORE_PATHS $SYSTEM_PROFILE_PATHS $USER_PROFILE_PATHS"
    # echo "GC root store paths: $ALL_GC_STORE_PATHS"
    # echo "System profile paths: $SYSTEM_PROFILE_PATHS"
    # echo "User profile paths: $USER_PROFILE_PATHS"
    # echo "All paths to preserve: $ALL_PATHS"

    if [ -n "$ALL_PATHS" ]; then
        echo "Filtering existing store paths..."
        VALID_PATHS=""
        for path in $ALL_PATHS; do
            if [ -e "$path" ]; then
                VALID_PATHS="$VALID_PATHS $path"
            else
                echo "Skipping missing path: $path"
            fi
        done
        
        echo "=== Exporting Nix store to NAR ==="
        if [ -n "$VALID_PATHS" ]; then
            echo "Exporting NAR with existing paths..."
            echo "Valid paths: $VALID_PATHS"
            sudo $nix_store_cmd --export --quiet $(sudo $nix_store_cmd -qR $VALID_PATHS 2>/dev/null) > "$NIX_STORE_NAR"
            echo "Exported NAR with all existing GC roots and profiles"
            ls -lh "$NIX_STORE_NAR"
        else
            echo "No existing store paths found to export"
        fi
    else
        echo "No store paths found to export"
    fi
}

# Main command dispatcher
case "${1:-}" in
    "restore-store")
        restore_nix_store
        ;;
    "install-devenv")
        install_devenv
        ;;
    "build-shell")
        build_devenv_shell
        ;;
    "nx-affected")
        run_nx_affected "$2" "$3" "$4"
        ;;
    "nix-gc")
        run_garbage_collection
        ;;
    "export-store")
        export_nix_store
        ;;
    *)
        echo "Usage: $0 {restore-store|install-devenv|build-shell|nx-affected|nix-gc|export-store}"
        echo "  nx-affected <task> [check-name] [step-number]"
        exit 1
        ;;
esac 
