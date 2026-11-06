use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, System};

pub struct Resources {
    pub cpu: f32,
    pub cores: Vec<f32>,
    pub total: u64,
    pub available: u64,
    pub refresh_gap: Duration,
}

pub fn resource_validity(sample: &Resources) -> Result<(), &'static str> {
    if sample.cores.is_empty()
        || !sample.cpu.is_finite()
        || !(0.0..=100.0).contains(&sample.cpu)
        || sample
            .cores
            .iter()
            .any(|cpu| !cpu.is_finite() || !(0.0..=100.0).contains(cpu))
        || sample.total == 0
        || sample.available > sample.total
        || sample.refresh_gap < Duration::from_millis(250)
    {
        return Err("invalid-resource-sample");
    }
    if sample.cpu > 80.0 || (sample.available as f64 / sample.total as f64) < 0.15 {
        return Err("saturated-resource-sample");
    }
    Ok(())
}

pub fn clock_validity(
    gap: Duration,
    monotonic: Duration,
    wall: Duration,
) -> Result<(), &'static str> {
    if gap > Duration::from_millis(200) || monotonic.abs_diff(wall) > Duration::from_millis(200) {
        return Err("paused-timing-sample");
    }
    Ok(())
}

// One measurement owns this observer and joins it before reporting any result.
pub struct Observation {
    stop: Arc<AtomicBool>,
    observer: Option<thread::JoinHandle<Result<usize, &'static str>>>,
}

impl Observation {
    pub fn start() -> Result<Self, &'static str> {
        let stop = Arc::new(AtomicBool::new(false));
        let observer_stop = Arc::clone(&stop);
        let (ready, received) = mpsc::sync_channel(1);
        let observer = thread::Builder::new()
            .name("lifecycle-validity".into())
            .spawn(move || {
                let mut system = match System::new() {
                    Ok(system) => system,
                    Err(_) => {
                        let _ = ready.send(Err("resource-unavailable"));
                        return Err("resource-unavailable");
                    }
                };
                system.refresh_cpu_list(CpuRefreshKind::nothing().with_usage());
                system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
                let mut refreshed = Instant::now();
                thread::sleep(Duration::from_millis(270));
                system.refresh_cpu_usage();
                system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
                let admission = resources(&system, refreshed.elapsed());
                if let Err(error) = resource_validity(&admission) {
                    let _ = ready.send(Err(error));
                    return Err(error);
                }
                refreshed = Instant::now();
                let started = Instant::now();
                let wall_started = SystemTime::now();
                let mut previous = started;
                let mut samples = 1;
                if ready.send(Ok(())).is_err() {
                    return Err("observer-admission-lost");
                }
                while !observer_stop.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(20));
                    let now = Instant::now();
                    clock_validity(
                        now.duration_since(previous),
                        now.duration_since(started),
                        wall_started
                            .elapsed()
                            .map_err(|_| "wall-clock-unavailable")?,
                    )?;
                    previous = now;
                    if refreshed.elapsed() >= Duration::from_millis(250) {
                        let gap = refreshed.elapsed();
                        system.refresh_cpu_usage();
                        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
                        resource_validity(&resources(&system, gap))?;
                        refreshed = Instant::now();
                        samples += 1;
                    }
                }
                Ok(samples)
            })
            .map_err(|_| "observer-spawn")?;
        let observation = Self {
            stop,
            observer: Some(observer),
        };
        match received.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(observation),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("observer-admission-unavailable"),
        }
    }

    pub fn finish(mut self) -> Result<usize, &'static str> {
        self.stop.store(true, Ordering::Release);
        self.observer
            .take()
            .unwrap()
            .join()
            .map_err(|_| "observer-panicked")?
    }
}

impl Drop for Observation {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(observer) = self.observer.take() {
            let _ = observer.join();
        }
    }
}

fn resources(system: &System, refresh_gap: Duration) -> Resources {
    Resources {
        cpu: system.global_cpu_usage(),
        cores: system.cpus().iter().map(|cpu| cpu.usage()).collect(),
        total: system.total_memory(),
        available: system.available_memory(),
        refresh_gap,
    }
}
