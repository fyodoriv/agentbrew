use std::io;

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct BoundedReturn {
    pub(crate) items: usize,
    pub(crate) complete: bool,
}

pub(crate) fn checked_capacity(slots: usize) -> io::Result<i32> {
    let bytes = slots
        .checked_mul(std::mem::size_of::<u32>())
        .filter(|bytes| *bytes > 0)
        .and_then(|bytes| <i32 as std::convert::TryFrom<usize>>::try_from(bytes).ok());
    bytes.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid PID capacity"))
}

pub(crate) fn bounded_return(
    returned_bytes: i32,
    errno: Option<i32>,
    slots: usize,
) -> io::Result<BoundedReturn> {
    let provided_bytes = checked_capacity(slots)?;
    if returned_bytes <= 0 {
        return Err(match errno.filter(|error| *error > 0) {
            Some(error) => io::Error::from_raw_os_error(error),
            None => io::Error::new(io::ErrorKind::InvalidData, "empty or failed group query"),
        });
    }
    if returned_bytes > provided_bytes || returned_bytes as usize % std::mem::size_of::<u32>() != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid group query length",
        ));
    }
    let items = returned_bytes as usize / std::mem::size_of::<u32>();
    Ok(BoundedReturn {
        items,
        complete: items < slots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_group_capacity_is_exactly_two_pid_words() {
        assert_eq!(checked_capacity(2).unwrap(), 8);
    }

    #[test]
    fn bounded_group_capacity_preserves_one_slot_bound() {
        assert_eq!(checked_capacity(1).unwrap(), 4);
    }

    #[test]
    fn bounded_group_zero_capacity_refuses() {
        assert!(checked_capacity(0).is_err());
    }

    #[test]
    fn bounded_group_capacity_multiplication_overflow_refuses() {
        assert!(checked_capacity(usize::MAX).is_err());
    }

    #[test]
    fn bounded_group_capacity_larger_than_native_int_refuses() {
        assert!(checked_capacity(i32::MAX as usize / 4 + 1).is_err());
    }

    #[test]
    fn bounded_group_singleton_is_complete_inside_two_slots() {
        assert_eq!(
            bounded_return(4, None, 2).unwrap(),
            BoundedReturn {
                items: 1,
                complete: true
            }
        );
    }

    #[test]
    fn bounded_group_two_slot_filled_result_is_incomplete() {
        assert_eq!(
            bounded_return(8, None, 2).unwrap(),
            BoundedReturn {
                items: 2,
                complete: false
            }
        );
    }

    #[test]
    fn bounded_group_one_slot_filled_result_is_incomplete() {
        assert_eq!(
            bounded_return(4, None, 1).unwrap(),
            BoundedReturn {
                items: 1,
                complete: false
            }
        );
    }

    #[test]
    fn bounded_group_zero_result_never_proves_complete() {
        assert!(bounded_return(0, None, 2).is_err());
    }

    #[test]
    fn bounded_group_partial_word_refuses() {
        assert!(bounded_return(5, None, 2).is_err());
    }

    #[test]
    fn bounded_group_return_larger_than_provided_buffer_refuses() {
        assert!(bounded_return(12, None, 2).is_err());
    }

    #[test]
    fn bounded_group_negative_query_preserves_permission_error() {
        assert_eq!(
            bounded_return(-1, Some(1), 2).unwrap_err().raw_os_error(),
            Some(1)
        );
    }

    #[test]
    fn bounded_group_zero_query_preserves_permission_error() {
        assert_eq!(
            bounded_return(0, Some(1), 2).unwrap_err().raw_os_error(),
            Some(1)
        );
    }

    #[test]
    fn bounded_group_invalid_capacity_refuses_before_result() {
        assert!(bounded_return(4, None, 0).is_err());
    }
}
