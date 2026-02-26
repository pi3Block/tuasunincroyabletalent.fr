/**
 * Mobile-friendly volume slider with touch optimization.
 */
import React, { useCallback } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'
import { Volume2, VolumeX, Volume1 } from 'lucide-react'

interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
  muted?: boolean
  onMuteToggle?: () => void
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  showValue?: boolean
  className?: string
}

export const VolumeSlider = React.memo(function VolumeSlider({
  value,
  onChange,
  muted = false,
  onMuteToggle,
  orientation = 'horizontal',
  size = 'md',
  showIcon = true,
  showValue = false,
  className,
}: VolumeSliderProps) {
  const handleValueChange = useCallback(
    (values: number[]) => {
      onChange(values[0] / 100)
    },
    [onChange]
  )

  const sizeClasses = {
    sm: {
      track: orientation === 'horizontal' ? 'h-1' : 'w-1',
      thumb: 'h-3 w-3',
      icon: 'h-4 w-4',
      container: 'gap-1.5',
    },
    md: {
      track: orientation === 'horizontal' ? 'h-1.5' : 'w-1.5',
      thumb: 'h-4 w-4',
      icon: 'h-5 w-5',
      container: 'gap-2',
    },
    lg: {
      track: orientation === 'horizontal' ? 'h-2' : 'w-2',
      thumb: 'h-5 w-5',
      icon: 'h-6 w-6',
      container: 'gap-3',
    },
  }

  const classes = sizeClasses[size]
  const displayValue = muted ? 0 : value * 100

  // Choose icon based on volume level
  const VolumeIcon = muted || value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={cn(
        'flex items-center',
        orientation === 'vertical' && 'flex-col-reverse h-full',
        classes.container,
        className
      )}
    >
      {showIcon && (
        <button
          onClick={onMuteToggle}
          className={cn(
            'text-muted-foreground hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95',
            'min-w-[44px] min-h-[44px] flex items-center justify-center -m-2'
          )}
          type="button"
          aria-label={muted ? 'Activer le son' : 'Couper le son'}
        >
          <VolumeIcon className={classes.icon} />
        </button>
      )}

      <SliderPrimitive.Root
        value={[displayValue]}
        onValueChange={handleValueChange}
        max={100}
        step={1}
        orientation={orientation}
        className={cn(
          'relative flex touch-none select-none',
          orientation === 'horizontal'
            ? 'w-full items-center'
            : 'h-full flex-col items-center'
        )}
      >
        <SliderPrimitive.Track
          className={cn(
            'relative grow overflow-hidden rounded-full bg-muted',
            orientation === 'horizontal' ? 'w-full' : 'h-full',
            classes.track
          )}
        >
          <SliderPrimitive.Range
            className={cn(
              'absolute rounded-full transition-colors',
              muted ? 'bg-muted-foreground/30' : 'bg-primary',
              orientation === 'horizontal' ? 'h-full' : 'w-full'
            )}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'block rounded-full border-2 border-primary bg-background shadow',
            'transition-colors focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
            // Larger touch target for mobile
            'touch-manipulation',
            // Visual hover effect
            'hover:border-primary/80 hover:bg-primary/5',
            classes.thumb
          )}
        />
      </SliderPrimitive.Root>

      {showValue && (
        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
          {Math.round(displayValue)}%
        </span>
      )}
    </div>
  )
})
