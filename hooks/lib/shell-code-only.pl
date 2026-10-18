#!/usr/bin/perl
# agentbrew/hooks/lib/shell-code-only.pl
#
# Reads a shell command on stdin and prints only the parts the shell runs as
# code. Quoted strings become empty quotes, comments are dropped, and
# heredoc bodies are dropped. A hook can then match keywords such as
# `until` or `sleep` without firing on text inside `echo "..."` or a
# heredoc. It is a heuristic, not a shell parser: `$(...)` inside double
# quotes counts as text.
use strict;
use warnings;

local $/;
my $s = <STDIN>;
$s = '' unless defined $s;

my $out = '';
my @pending;    # heredocs opened on the current line: [delimiter, strip_tabs]
my $n = length $s;
my $i = 0;

while ($i < $n) {
  my $c = substr($s, $i, 1);

  if ($c eq '\\') { $out .= ' '; $i += 2; next; }

  if ($c eq "'") {
    my $end = index($s, "'", $i + 1);
    $end = $n - 1 if $end < 0;
    $out .= "''";
    $i = $end + 1;
    next;
  }

  if ($c eq '"') {
    my $j = $i + 1;
    while ($j < $n) {
      my $d = substr($s, $j, 1);
      if ($d eq '\\') { $j += 2; next; }
      last if $d eq '"';
      $j++;
    }
    $out .= '""';
    $i = $j + 1;
    next;
  }

  if ($c eq '#' && ($i == 0 || substr($s, $i - 1, 1) =~ /[\s;&|(]/)) {
    my $nl = index($s, "\n", $i);
    $i = $nl < 0 ? $n : $nl;
    next;
  }

  if (substr($s, $i, 3) eq '<<<') { $out .= '<<<'; $i += 3; next; }

  if (substr($s, $i, 2) eq '<<'
    && substr($s, $i) =~ /\A<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z_0-9]+))/) {
    my $strip = $1 eq '-';
    my $delim = defined $2 ? $2 : defined $3 ? $3 : $4;
    push @pending, [$delim, $strip];
    $out .= '<<';
    $i += length $&;
    next;
  }

  if ($c eq "\n" && @pending) {
    $out .= "\n";
    $i++;
    for my $h (@pending) {
      my ($delim, $strip) = @$h;
      while ($i < $n) {
        my $nl = index($s, "\n", $i);
        my $line = $nl < 0 ? substr($s, $i) : substr($s, $i, $nl - $i);
        $i = $nl < 0 ? $n : $nl + 1;
        $line =~ s/\A\t+// if $strip;
        last if $line eq $delim;
      }
    }
    @pending = ();
    next;
  }

  $out .= $c;
  $i++;
}

print $out;
