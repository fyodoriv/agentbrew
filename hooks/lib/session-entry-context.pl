#!/usr/bin/perl
# State belongs to this hook invocation. No persistent state is created.
use strict;
use warnings;
use Cwd qw(abs_path getcwd);
use Encode qw(decode FB_QUIET);
use File::Basename qw(dirname);
use File::Temp qw(tempfile);
use JSON::PP qw(decode_json);
use Time::HiRes qw(alarm);

my $helper_pid;
$SIG{ALRM} = sub {
    kill 'KILL', -$helper_pid if defined $helper_pid;
    exit 0;
};
alarm 0.75;

my $input = '';
read STDIN, $input, 65537;
exit 0 if length($input) > 65536;
my $event = eval { decode_json($input) };
exit 0 if $@ || ref($event) ne 'HASH';
exit 0 if ref($event->{hook_event_name}) || ($event->{hook_event_name} // '') ne 'SessionStart';
my $cwd = $event->{cwd} // getcwd();
exit 0 if !defined($cwd) || ref($cwd) || index($cwd, "\0") >= 0 || !-d $cwd;
my $root = abs_path($cwd);
exit 0 if !defined $root;
while (!-e "$root/.git") {
    my $parent = dirname($root);
    exit 0 if $parent eq $root;
    $root = $parent;
}

my $home = $ENV{HOME};
exit 0 if !defined($home) || $home eq '';
my $helper = "$home/.config/agentbrew/scripts/load-project-context.sh";
exit 0 if !-f $helper;
my $tool_path = '/usr/bin:/bin';
for my $git (
    '/Library/Developer/CommandLineTools/usr/bin/git',
    '/Applications/Xcode.app/Contents/Developer/usr/bin/git'
) {
    if (-x $git) {
        $tool_path = dirname($git) . ':' . $tool_path;
        last;
    }
}

# The capture file is unlinked on creation and closed when this invocation ends.
my ($capture, $capture_path) = tempfile(UNLINK => 1);
unlink $capture_path;
$helper_pid = fork();
exit 0 if !defined $helper_pid;
if ($helper_pid == 0) {
    setpgrp(0, 0) or exit 1;
    %ENV = (
        HOME => $home,
        PATH => $tool_path,
        GIT_CONFIG_GLOBAL => '/dev/null',
        GIT_CONFIG_NOSYSTEM => '1',
        GIT_OPTIONAL_LOCKS => '0',
    );
    chdir $root or exit 1;
    open STDIN, '<', '/dev/null' or exit 1;
    open STDOUT, '>&', $capture or exit 1;
    open STDERR, '>', '/dev/null' or exit 1;
    exec '/bin/bash', $helper, $root;
    exit 1;
}
waitpid($helper_pid, 0);
my $status = $?;
kill 'KILL', -$helper_pid;
exit 0 if $status != 0;
seek $capture, 0, 0;
my $listing = '';
read $capture, $listing, 2048;
$listing = decode('UTF-8', $listing, FB_QUIET);
$listing =~ s/^\s+|\s+$//g;
exit 0 if $listing eq '';

my $text = 'Use configured shared memory: get_bootstrap_profile, then memory_search '
    . "before context-dependent decisions. This reminder does not prove recall.\n"
    . $listing;
my $json = JSON::PP->new->utf8;
while (length $text) {
    my $output = $json->encode({
        hookSpecificOutput => {
            hookEventName => 'SessionStart',
            additionalContext => $text,
        },
    });
    if (length($output) + 1 <= 2048) {
        print "$output\n";
        exit 0;
    }
    chop $text;
}
